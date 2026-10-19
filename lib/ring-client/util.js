import debug from 'debug'
import chalk from 'chalk'
import { createHash, randomUUID } from 'crypto'
import { createInterface } from 'readline'
import pushReceiverLogger from '@eneris/push-receiver/dist/utils/logger.js'

const debugLogger = debug('ring-rapi'),
    uuidNamespaceBytes = Buffer.from('e53ffdc0e91d4ce1bec2df939d94739d', 'hex')

let logger = {
    logInfo(message) {
        debugLogger(message)
    },
    logError(message) {
        debugLogger(chalk.red(message))
    },
}

const timeouts = new Set()

export function clearTimeouts() {
    timeouts.forEach((timeout) => {
        clearTimeout(timeout)
    })
}

export function delay(milliseconds) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            timeouts.delete(timeout)
            resolve(undefined)
        }, milliseconds)
        timeouts.add(timeout)
    })
}

export function logDebug(message) {
    logger.logInfo(message)
}

export function logInfo(...message) {
    logger.logInfo(...message)
}

export function logError(message) {
    logger.logError(message)
}

export function useLogger(newLogger) {
    logger = newLogger
}

export function generateUuid(seed) {
    if (seed) {
        const hash = createHash('sha1').update(uuidNamespaceBytes).update(seed, 'utf8').digest()
        hash[6] = (hash[6] & 0x0f) | 0x50
        hash[8] = (hash[8] & 0x3f) | 0x80
        const hex = hash.subarray(0, 16).toString('hex')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    }
    return randomUUID()
}

export async function getHardwareId(systemId) {
    if (systemId) {
        return generateUuid(systemId)
    }
    return randomUUID()
}

export async function requestInput(question) {
    const lineReader = createInterface({
            input: process.stdin,
            output: process.stdout,
        }),
        answer = await new Promise((resolve) => {
            lineReader.question(question, resolve)
        })
    lineReader.close()
    return answer.trim()
}

export function stringify(data) {
    if (typeof data === 'string') {
        return data
    }
    if (typeof data === 'object' && Buffer.isBuffer(data)) {
        return data.toString()
    }
    return JSON.stringify(data) + ''
}

// Override push receiver logging to avoid ECONNRESET errors leaking
function logPushReceiver(...args) {
    try {
        if (args[0].toString().includes('ECONNRESET')) {
            // don't log ECONNRESET errors
            return
        }
    } catch {
        // proceed to log error
    }
    logDebug('[Push Receiver]')
    logDebug(args[0])
}

const pushReceiverLoggerDefault = pushReceiverLogger.default || pushReceiverLogger
pushReceiverLoggerDefault.error = logPushReceiver

export function fromBase64(encodedInput) {
    const buff = Buffer.from(encodedInput, 'base64')
    return buff.toString('ascii')
}

export function toBase64(input) {
    const buff = Buffer.from(input)
    return buff.toString('base64')
}

export function buildSearchString(search) {
    return (
        '?' +
        Object.entries(search)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => `${key}=${value}`)
            .join('&')
    )
}

