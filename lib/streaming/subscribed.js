// This code is largely copied from ring-client-api, but converted from Typescript
// to straight Javascript and some code not required for ring-mqtt removed.
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
