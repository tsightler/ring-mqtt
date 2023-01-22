// This code is largely copied from ring-client-api, but converted from Typescript
// to pure Javascript with some code not required for ring-mqtt removed
// Much thanks to @dgreif for this original work

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
