import Capacitor
import Foundation
import StoreKit

@objc(StoreKitPlugin)
public final class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "KODStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    public override func load() {
        updatesTask = Task { [weak self] in
            for await verification in Transaction.updates {
                guard !Task.isCancelled else { return }
                switch verification {
                case .verified(let transaction):
                    self?.notifyListeners("transactionUpdated", data: self?.transactionObject(
                        transaction,
                        signedTransaction: verification.jwsRepresentation
                    ) ?? [:])
                case .unverified(_, let error):
                    self?.notifyListeners("transactionVerificationFailed", data: ["error": error.localizedDescription])
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc public func products(_ call: CAPPluginCall) {
        let identifiers = call.getArray("productIds", String.self) ?? []
        guard !identifiers.isEmpty else {
            call.resolve(["products": []])
            return
        }
        Task {
            do {
                let products = try await Product.products(for: identifiers)
                call.resolve(["products": products.map(productObject)])
            } catch {
                call.reject("无法加载 App Store 商品", nil, error)
            }
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty,
              let rawAccountToken = call.getString("appAccountToken"),
              let accountToken = UUID(uuidString: rawAccountToken) else {
            call.reject("商品 ID 或 KAI 账户令牌无效")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("App Store 中不存在该商品")
                    return
                }
                let result = try await product.purchase(options: [.appAccountToken(accountToken)])
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        call.resolve([
                            "status": "purchased",
                            "transaction": transactionObject(transaction, signedTransaction: verification.jwsRepresentation)
                        ])
                    case .unverified(_, let error):
                        call.reject("StoreKit 交易未通过设备验证", nil, error)
                    }
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.reject("未知的 StoreKit 购买结果")
                }
            } catch {
                call.reject("StoreKit 购买失败", nil, error)
            }
        }
    }

    @objc public func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(["transactions": await currentEntitlements()])
            } catch {
                call.reject("恢复 App Store 购买失败", nil, error)
            }
        }
    }

    @objc public func unfinished(_ call: CAPPluginCall) {
        Task {
            var values: [JSObject] = []
            for await verification in Transaction.unfinished {
                if case .verified(let transaction) = verification {
                    values.append(transactionObject(transaction, signedTransaction: verification.jwsRepresentation))
                }
            }
            call.resolve(["transactions": values])
        }
    }

    @objc public func finish(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId"), let expected = UInt64(transactionId) else {
            call.reject("StoreKit transactionId 无效")
            return
        }
        Task {
            for await verification in Transaction.unfinished {
                if case .verified(let transaction) = verification, transaction.id == expected {
                    await transaction.finish()
                    call.resolve(["finished": true])
                    return
                }
            }
            call.resolve(["finished": false])
        }
    }

    private func currentEntitlements() async -> [JSObject] {
        var values: [JSObject] = []
        for await verification in Transaction.currentEntitlements {
            if case .verified(let transaction) = verification {
                values.append(transactionObject(
                    transaction,
                    signedTransaction: verification.jwsRepresentation,
                    needsFinish: false
                ))
            }
        }
        return values
    }

    private func productObject(_ product: Product) -> JSObject {
        var value: JSObject = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "type": product.type.rawValue
        ]
        if let subscription = product.subscription {
            value["subscriptionPeriod"] = [
                "value": subscription.subscriptionPeriod.value,
                "unit": String(describing: subscription.subscriptionPeriod.unit)
            ]
        }
        return value
    }

    private func transactionObject(
        _ transaction: Transaction,
        signedTransaction: String,
        needsFinish: Bool = true
    ) -> JSObject {
        var value: JSObject = [
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "signedTransaction": signedTransaction,
            "needsFinish": needsFinish
        ]
        if let appAccountToken = transaction.appAccountToken {
            value["appAccountToken"] = appAccountToken.uuidString.lowercased()
        }
        if let expirationDate = transaction.expirationDate {
            value["expirationDate"] = expirationDate.timeIntervalSince1970 * 1000
        }
        if let revocationDate = transaction.revocationDate {
            value["revocationDate"] = revocationDate.timeIntervalSince1970 * 1000
        }
        return value
    }
}
