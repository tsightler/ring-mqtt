// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

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
