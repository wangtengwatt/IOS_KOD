import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import Security
import UIKit

extension Notification.Name {
    static let kodKaiIdentityCallback = Notification.Name("KODKaiIdentityCallback")
}

@objc(KaiIdentityPlugin)
public final class KaiIdentityPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "KaiIdentityPlugin"
    public let jsName = "KaiIdentity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private static let requiredRedirectHost = "kod.kai.com"
    private static let requiredRedirectPath = "/auth/ios/callback"
    private var session: ASWebAuthenticationSession?
    private var legacyPending: LegacyPending?
    private var legacyTimeout: DispatchWorkItem?

    private struct LegacyPending {
        let config: Config
        let verifier: String
        let state: String
        let call: CAPPluginCall
    }

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(receiveLegacyUniversalLink(_:)),
            name: .kodKaiIdentityCallback,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        legacyTimeout?.cancel()
    }

    @objc public func login(_ call: CAPPluginCall) {
        session?.cancel()

        do {
            let config = try parseConfig(call)
            let verifier = try randomURLSafeString(byteCount: 32)
            let state = try randomURLSafeString(byteCount: 32)
            let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
            let authorizationURL = try makeAuthorizationURL(config: config, state: state, challenge: challenge)
            if #available(iOS 17.4, *) {
                startWebAuthenticationSession(
                    authorizationURL: authorizationURL,
                    config: config,
                    verifier: verifier,
                    state: state,
                    call: call
                )
            } else {
                startLegacyUniversalLinkFlow(
                    authorizationURL: authorizationURL,
                    config: config,
                    verifier: verifier,
                    state: state,
                    call: call
                )
            }
        } catch {
            call.resolve(["success": false, "error": error.localizedDescription])
        }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        session?.cancel()
        session = nil
        if let pending = legacyPending {
            clearLegacyPending()
            pending.call.resolve(["success": false, "error": "KAI Identity 登录已取消"])
        }
        call.resolve()
    }

    @available(iOS 17.4, *)
    private func startWebAuthenticationSession(
        authorizationURL: URL,
        config: Config,
        verifier: String,
        state: String,
        call: CAPPluginCall
    ) {
        let callback = ASWebAuthenticationSession.Callback.https(
            host: Self.requiredRedirectHost,
            path: Self.requiredRedirectPath
        )
        let authSession = ASWebAuthenticationSession(url: authorizationURL, callback: callback) {
            [weak self] callbackURL, error in
            guard let self else { return }
            self.session = nil
            if let authError = error as? ASWebAuthenticationSessionError,
               authError.code == .canceledLogin {
                call.resolve(["success": false, "error": "KAI Identity 登录已取消"])
                return
            }
            if let error {
                call.resolve(["success": false, "error": error.localizedDescription])
                return
            }
            self.complete(config: config, verifier: verifier, state: state, callbackURL: callbackURL, call: call)
        }
        authSession.presentationContextProvider = self
        authSession.prefersEphemeralWebBrowserSession = false
        session = authSession
        if !authSession.start() {
            session = nil
            call.resolve(["success": false, "error": "无法启动 KAI Identity 登录会话"])
        }
    }

    private func startLegacyUniversalLinkFlow(
        authorizationURL: URL,
        config: Config,
        verifier: String,
        state: String,
        call: CAPPluginCall
    ) {
        if let pending = legacyPending {
            pending.call.resolve(["success": false, "error": "新的 KAI Identity 登录已开始"])
        }
        clearLegacyPending()
        legacyPending = LegacyPending(config: config, verifier: verifier, state: state, call: call)
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, let pending = self.legacyPending else { return }
            self.clearLegacyPending()
            pending.call.resolve(["success": false, "error": "KAI Identity 登录超时，请重试"])
        }
        legacyTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: timeout)
        DispatchQueue.main.async {
            UIApplication.shared.open(authorizationURL, options: [:]) { [weak self] accepted in
                guard !accepted, let self, let pending = self.legacyPending else { return }
                self.clearLegacyPending()
                pending.call.resolve(["success": false, "error": "无法打开 KAI Identity 登录页面"])
            }
        }
    }

    @objc private func receiveLegacyUniversalLink(_ notification: Notification) {
        guard let url = notification.object as? URL, let pending = legacyPending else { return }
        clearLegacyPending()
        complete(
            config: pending.config,
            verifier: pending.verifier,
            state: pending.state,
            callbackURL: url,
            call: pending.call
        )
    }

    private func clearLegacyPending() {
        legacyTimeout?.cancel()
        legacyTimeout = nil
        legacyPending = nil
    }

    private func complete(
        config: Config,
        verifier: String,
        state: String,
        callbackURL: URL?,
        call: CAPPluginCall
    ) {
        do {
            let code = try validateCallback(callbackURL, expectedState: state)
            exchangeCode(config: config, code: code, verifier: verifier, call: call)
        } catch {
            call.resolve(["success": false, "error": error.localizedDescription])
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        if let windowScene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
           let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }

    private struct Config {
        let clientId: String
        let authorizationEndpoint: URL
        let tokenEndpoint: URL
        let redirectUri: String
        let scope: String
    }

    private enum PluginError: LocalizedError {
        case invalidConfig(String)
        case invalidCallback(String)
        case tokenExchange(String)

        var errorDescription: String? {
            switch self {
            case .invalidConfig(let detail): return "KAI Identity 配置无效：\(detail)"
            case .invalidCallback(let detail): return "KAI Identity 回调无效：\(detail)"
            case .tokenExchange(let detail): return "KAI Identity 令牌交换失败：\(detail)"
            }
        }
    }

    private func parseConfig(_ call: CAPPluginCall) throws -> Config {
        guard let value = call.getObject("config") else {
            throw PluginError.invalidConfig("缺少 config")
        }
        guard value["enabled"] as? Bool == true else {
            throw PluginError.invalidConfig("服务端尚未启用")
        }
        guard let clientId = nonEmpty(value["clientId"] as? String) else {
            throw PluginError.invalidConfig("缺少 clientId")
        }
        guard let authorizationEndpoint = secureURL(value["authorizationEndpoint"] as? String) else {
            throw PluginError.invalidConfig("authorizationEndpoint 必须使用 HTTPS")
        }
        guard let tokenEndpoint = secureURL(value["tokenEndpoint"] as? String) else {
            throw PluginError.invalidConfig("tokenEndpoint 必须使用 HTTPS")
        }
        guard let redirectUri = nonEmpty(value["redirectUri"] as? String),
              let redirectURL = URL(string: redirectUri),
              redirectURL.scheme == "https",
              redirectURL.host == Self.requiredRedirectHost,
              redirectURL.path == Self.requiredRedirectPath else {
            throw PluginError.invalidConfig("redirectUri 必须为 https://kod.kai.com/auth/ios/callback")
        }
        guard let scope = nonEmpty(value["scope"] as? String) else {
            throw PluginError.invalidConfig("缺少 scope")
        }
        return Config(
            clientId: clientId,
            authorizationEndpoint: authorizationEndpoint,
            tokenEndpoint: tokenEndpoint,
            redirectUri: redirectUri,
            scope: scope
        )
    }

    private func makeAuthorizationURL(config: Config, state: String, challenge: String) throws -> URL {
        guard var parts = URLComponents(url: config.authorizationEndpoint, resolvingAgainstBaseURL: false) else {
            throw PluginError.invalidConfig("authorizationEndpoint 无法解析")
        }
        var queryItems = parts.queryItems ?? []
        queryItems.append(contentsOf: [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: config.redirectUri),
            URLQueryItem(name: "scope", value: config.scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state)
        ])
        parts.queryItems = queryItems
        guard let url = parts.url else {
            throw PluginError.invalidConfig("无法生成 authorization URL")
        }
        return url
    }

    private func validateCallback(_ url: URL?, expectedState: String) throws -> String {
        guard let url,
              url.scheme == "https",
              url.host == Self.requiredRedirectHost,
              url.path == Self.requiredRedirectPath,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw PluginError.invalidCallback("回调地址不匹配")
        }
        let values = Dictionary(uniqueKeysWithValues: (parts.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        if let oauthError = values["error"], !oauthError.isEmpty {
            throw PluginError.invalidCallback(values["error_description"] ?? oauthError)
        }
        guard values["state"] == expectedState else {
            throw PluginError.invalidCallback("state 校验失败")
        }
        guard let code = values["code"], !code.isEmpty else {
            throw PluginError.invalidCallback("缺少授权码")
        }
        return code
    }

    private func exchangeCode(config: Config, code: String, verifier: String, call: CAPPluginCall) {
        var request = URLRequest(url: config.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncoded([
            "grant_type": "authorization_code",
            "client_id": config.clientId,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": config.redirectUri
        ])

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                call.resolve(["success": false, "error": PluginError.tokenExchange(error.localizedDescription).localizedDescription])
                return
            }
            guard let http = response as? HTTPURLResponse, let data else {
                call.resolve(["success": false, "error": PluginError.tokenExchange("服务端没有返回有效响应").localizedDescription])
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                call.resolve(["success": false, "error": PluginError.tokenExchange("HTTP \(http.statusCode)").localizedDescription])
                return
            }
            do {
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let accessToken = json["access_token"] as? String,
                      !accessToken.isEmpty else {
                    throw PluginError.tokenExchange("响应缺少 access_token")
                }
                var credentials: JSObject = ["accessToken": accessToken]
                if let refreshToken = json["refresh_token"] as? String {
                    credentials["refreshToken"] = refreshToken
                }
                if let expiresIn = json["expires_in"] as? NSNumber {
                    credentials["expiresAt"] = Date().timeIntervalSince1970 * 1000 + expiresIn.doubleValue * 1000
                }
                if let idToken = json["id_token"] as? String {
                    credentials["extra"] = ["idToken": idToken]
                }
                call.resolve(["success": true, "credentials": credentials])
            } catch {
                call.resolve(["success": false, "error": error.localizedDescription])
            }
        }.resume()
    }

    private func secureURL(_ raw: String?) -> URL? {
        guard let raw = nonEmpty(raw), let url = URL(string: raw), url.scheme == "https", url.host != nil else {
            return nil
        }
        return url
    }

    private func nonEmpty(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private func randomURLSafeString(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw PluginError.invalidConfig("无法生成安全随机数")
        }
        return base64URL(Data(bytes))
    }

    private func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func formEncoded(_ values: [String: String]) -> Data? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=")
        let body = values
            .sorted(by: { $0.key < $1.key })
            .map { key, value in
                let escapedKey = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
                let escapedValue = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
                return "\(escapedKey)=\(escapedValue)"
            }
            .joined(separator: "&")
        return body.data(using: .utf8)
    }
}
