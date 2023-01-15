export class Subscribed {
    constructor() {
        this.subscriptions = []
    }
    addSubscriptions(...subscriptions) {
        this.subscriptions.push(...subscriptions)
    }
    unsubscribe() {
        this.subscriptions.forEach((subscription) => subscription.unsubscribe())
    }
}
