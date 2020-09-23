import { createSelector } from 'reselect'
import {
  SUBMITTED_STATUS,
  CONFIRMED_STATUS,
  PRIORITY_STATUS_HASH,
  PENDING_STATUS_HASH,
  UNAPPROVED_STATUS,
  INCOMING_TRANSACTION,
  CANCELLED_STATUS,
} from '../helpers/constants/transactions'
import {
  TRANSACTION_TYPE_CANCEL,
  TRANSACTION_TYPE_RETRY,
  TRANSACTION_TYPE_STANDARD,
} from '../../../app/scripts/controllers/transactions/enums'
import { hexToDecimal } from '../helpers/utils/conversions.util'
import txHelper from '../../lib/tx-helper'
import {
  getSelectedAddress,
} from '.'

export const incomingTxListSelector = (state) => {
  const { showIncomingTransactions } = state.metamask.featureFlags
  if (!showIncomingTransactions) {
    return []
  }

  const { network } = state.metamask
  const selectedAddress = getSelectedAddress(state)
  return Object.values(state.metamask.incomingTransactions)
    .filter(({ metamaskNetworkId, txParams }) => (
      txParams.to === selectedAddress && metamaskNetworkId === network
    ))
}
export const unapprovedMsgsSelector = (state) => state.metamask.unapprovedMsgs
export const currentNetworkTxListSelector = (state) => state.metamask.currentNetworkTxList
export const unapprovedPersonalMsgsSelector = (state) => state.metamask.unapprovedPersonalMsgs
export const unapprovedDecryptMsgsSelector = (state) => state.metamask.unapprovedDecryptMsgs
export const unapprovedEncryptionPublicKeyMsgsSelector = (state) => state.metamask.unapprovedEncryptionPublicKeyMsgs
export const unapprovedTypedMessagesSelector = (state) => state.metamask.unapprovedTypedMessages
export const networkSelector = (state) => state.metamask.network

export const selectedAddressTxListSelector = createSelector(
  getSelectedAddress,
  currentNetworkTxListSelector,
  (selectedAddress, transactions = []) => {
    return transactions.filter(({ txParams }) => txParams.from === selectedAddress)
  },
)

export const unapprovedMessagesSelector = createSelector(
  unapprovedMsgsSelector,
  unapprovedPersonalMsgsSelector,
  unapprovedDecryptMsgsSelector,
  unapprovedEncryptionPublicKeyMsgsSelector,
  unapprovedTypedMessagesSelector,
  networkSelector,
  (
    unapprovedMsgs = {},
    unapprovedPersonalMsgs = {},
    unapprovedDecryptMsgs = {},
    unapprovedEncryptionPublicKeyMsgs = {},
    unapprovedTypedMessages = {},
    network,
  ) => txHelper(
    {},
    unapprovedMsgs,
    unapprovedPersonalMsgs,
    unapprovedDecryptMsgs,
    unapprovedEncryptionPublicKeyMsgs,
    unapprovedTypedMessages,
    network,
  ) || [],
)

export const transactionSubSelector = createSelector(
  unapprovedMessagesSelector,
  incomingTxListSelector,
  (unapprovedMessages = [], incomingTxList = []) => {
    return unapprovedMessages.concat(incomingTxList)
  },
)

export const transactionsSelector = createSelector(
  transactionSubSelector,
  selectedAddressTxListSelector,
  (subSelectorTxList = [], selectedAddressTxList = []) => {
    const txsToRender = selectedAddressTxList.concat(subSelectorTxList)

    return txsToRender
      .sort((a, b) => b.time - a.time)
  },
)

/**
 * @name insertOrderedNonce
 * @private
 * @description Inserts (mutates) a nonce into an array of ordered nonces, sorted in ascending
 * order.
 * @param {string[]} nonces - Array of nonce strings in hex
 * @param {string} nonceToInsert - Nonce string in hex to be inserted into the array of nonces.
 * @returns {string[]}
 */
const insertOrderedNonce = (nonces, nonceToInsert) => {
  let insertIndex = nonces.length

  for (let i = 0; i < nonces.length; i++) {
    const nonce = nonces[i]

    if (Number(hexToDecimal(nonce)) > Number(hexToDecimal(nonceToInsert))) {
      insertIndex = i
      break
    }
  }

  nonces.splice(insertIndex, 0, nonceToInsert)
}

/**
 * @name insertTransactionByTime
 * @private
 * @description Inserts (mutates) a transaction object into an array of ordered transactions, sorted
 * in ascending order by time.
 * @param {Object[]} transactions - Array of transaction objects.
 * @param {Object} transaction - Transaction object to be inserted into the array of transactions.
 * @returns {Object[]}
 */
const insertTransactionByTime = (transactions, transaction) => {
  const { time } = transaction

  let insertIndex = transactions.length

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]

    if (tx.time > time) {
      insertIndex = i
      break
    }
  }

  transactions.splice(insertIndex, 0, transaction)
}

/**
 * Contains transactions and properties associated with those transactions of the same nonce.
 * @typedef {Object} transactionGroup
 * @property {string} nonce - The nonce that the transactions within this transactionGroup share.
 * @property {Object[]} transactions - An array of transaction (txMeta) objects.
 * @property {Object} initialTransaction - The transaction (txMeta) with the lowest "time".
 * @property {Object} primaryTransaction - Either the latest transaction or the confirmed
 * transaction.
 * @property {boolean} hasRetried - True if a transaction in the group was a retry transaction.
 * @property {boolean} hasCancelled - True if a transaction in the group was a cancel transaction.
 */

/**
 * @name insertTransactionGroupByTime
 * @private
 * @description Inserts (mutates) a transactionGroup object into an array of ordered
 * transactionGroups, sorted in ascending order by nonce.
 * @param {transactionGroup[]} transactionGroups - Array of transactionGroup objects.
 * @param {transactionGroup} transactionGroup - transactionGroup object to be inserted into the
 * array of transactionGroups.
 */
const insertTransactionGroupByTime = (transactionGroups, transactionGroup) => {
  const { primaryTransaction: { time: groupToInsertTime } = {} } = transactionGroup

  let insertIndex = transactionGroups.length

  for (let i = 0; i < transactionGroups.length; i++) {
    const txGroup = transactionGroups[i]
    const { primaryTransaction: { time } = {} } = txGroup

    if (time > groupToInsertTime) {
      insertIndex = i
      break
    }
  }

  transactionGroups.splice(insertIndex, 0, transactionGroup)
}

/**
 * @name mergeNonNonceTransactionGroups
 * @private
 * @description Inserts (mutates) transactionGroups that are not to be ordered by nonce into an array
 * of nonce-ordered transactionGroups by time.
 * @param {transactionGroup[]} orderedTransactionGroups - Array of transactionGroups ordered by
 * nonce.
 * @param {transactionGroup[]} nonNonceTransactionGroups - Array of transactionGroups not intended to be ordered by nonce,
 * but intended to be ordered by timestamp
 */
const mergeNonNonceTransactionGroups = (orderedTransactionGroups, nonNonceTransactionGroups) => {
  nonNonceTransactionGroups.forEach((transactionGroup) => {
    insertTransactionGroupByTime(orderedTransactionGroups, transactionGroup)
  })
}

const incomingAndUnapprovedSelector = createSelector(
  transactionsSelector,
  (transactions) => transactions.filter((tx) => typeof tx.txParams.nonce === 'undefined' || tx.transactionCategory === INCOMING_TRANSACTION),
)

const outgoingTransactionsWithNonceSelector = createSelector(
  transactionsSelector,
  (transactions) => transactions.filter((tx) => typeof tx.txParams.nonce !== 'undefined' && tx.transactionCategory !== INCOMING_TRANSACTION),
)

/**
 * WIP
 */
export const transactionsGroupedByNonceSelector = createSelector(
  outgoingTransactionsWithNonceSelector,
  (transactions = []) => {
    // Use a Map to store groups by nonce in decimal format. This helps with ordering
    const nonceMap = new Map()
    // Rather than sorting the Map after we've grouped, keep an array of ordered nonces
    // that we update as we iterate through transactions
    const orderedNonces = []
    transactions.forEach((transaction) => {
      const { nonce } = transaction.txParams
      const nonceNumber = Number(hexToDecimal(nonce))
      const hasExistingGroup = nonceMap.has(nonceNumber)
      const group = hasExistingGroup ? nonceMap.get(nonceNumber) : {
        transactions: [],
        hasRetried: false,
        hasCancelled: false,
        status: undefined,
        category: undefined,
        type: undefined,
        oldestTransaction: undefined,
        newestTransaction: undefined,
        nonce: undefined,
      }

      if (!hasExistingGroup) {
        // if this is the first time we've seen this nonce, insert it into the orderedNonces array
        // in the proper location. To find the insertion point, starting from the earliest nonce,
        // check if this transaction's nonce is lower. If it is lower, it should be inserted at this index
        let nonceInsertionIndex = orderedNonces.findIndex((nonceA) => nonceNumber < nonceA)
        // If we do not find a matching index, set insertion index equal to length of array
        if (nonceInsertionIndex === -1) {
          nonceInsertionIndex = orderedNonces.length
        }
        orderedNonces.splice(nonceInsertionIndex, 0, nonceNumber)
      }

      // Create a copy of the array to avoid mutating the original array
      const transactionsClone = group.transactions.slice()

      // First step is to figure out in which position the new transaction should be inserted into the array
      let insertionIndex = 0

      if (group.transactions.length > 0) {
        // Find the first transaction in the array that occurred *after* our transaction
        insertionIndex = group.transactions.findIndex((tx) => transaction.time < tx.time)
        // If we don't find a matching index, we need to add to the end of the array
        if (insertionIndex === -1) {
          insertionIndex = group.transactions.length
        }
      }

      transactionsClone.splice(insertionIndex, 0, transaction)

      // Cancel transactions are simply new transactions with higher gas and zero send amount.
      // In our UI we likely do not want to show this transaction as an individual entry, we'd
      // want to show the most relevant original transaction, but with a UI treatment to indicate
      // the cancellation.
      const nonCancelledTxs = transactionsClone.filter((tx) => tx.type !== TRANSACTION_TYPE_CANCEL)

      // Newest transaction should point to the latest retry or standard type transaction.
      const newestTransaction = nonCancelledTxs[0] // Beneficial in the case of speed ups and retries

      // Oldest transaction should point to the original standard type transaction
      const oldestTransaction = nonCancelledTxs[nonCancelledTxs.length - 1] // Should be the original user intention

      let { hasRetried } = group
      let { hasCancelled } = group

      let status = newestTransaction?.status ?? UNAPPROVED_STATUS

      if (transaction.type === TRANSACTION_TYPE_RETRY) {
        hasRetried = true
      } else if (transaction.type === TRANSACTION_TYPE_CANCEL) {
        hasCancelled = true
        if (transaction.status === CONFIRMED_STATUS) {
          status = CANCELLED_STATUS
        }
      }

      nonceMap.set(nonce, {
        nonce,
        newestTransaction,
        oldestTransaction,
        hasCancelled,
        hasRetried,
        transactions: transactionsClone,
        type: oldestTransaction?.type ?? TRANSACTION_TYPE_STANDARD,
        status,
        category: newestTransaction?.transactionCategory ?? transaction.transactionCategory,
      })
    })

    return orderedNonces.map((nonce) => nonceMap.get(nonce))
  },
)

/**
 * @name nonceSortedTransactionsSelector
 * @description Returns an array of transactionGroups sorted by nonce in ascending order.
 * @returns {transactionGroup[]}
 */
export const nonceSortedTransactionsSelector = createSelector(
  transactionsSelector,
  (transactions = []) => {
    const unapprovedTransactionGroups = []
    const incomingTransactionGroups = []
    const orderedNonces = []
    const nonceToTransactionsMap = {}

    transactions.forEach((transaction) => {
      const { txParams: { nonce } = {}, status, type, time: txTime, transactionCategory } = transaction

      if (typeof nonce === 'undefined' || transactionCategory === 'incoming') {
        const transactionGroup = {
          transactions: [transaction],
          initialTransaction: transaction,
          primaryTransaction: transaction,
          hasRetried: false,
          hasCancelled: false,
        }

        if (transactionCategory === 'incoming') {
          incomingTransactionGroups.push(transactionGroup)
        } else {
          insertTransactionGroupByTime(unapprovedTransactionGroups, transactionGroup)
        }
      } else if (nonce in nonceToTransactionsMap) {
        const nonceProps = nonceToTransactionsMap[nonce]
        insertTransactionByTime(nonceProps.transactions, transaction)

        if (status in PRIORITY_STATUS_HASH) {
          const { primaryTransaction: { time: primaryTxTime = 0 } = {} } = nonceProps

          if (status === CONFIRMED_STATUS || txTime > primaryTxTime) {
            nonceProps.primaryTransaction = transaction
          }
        }

        const { initialTransaction: { time: initialTxTime = 0 } = {} } = nonceProps

        // Used to display the transaction action, since we don't want to overwrite the action if
        // it was replaced with a cancel attempt transaction.
        if (txTime < initialTxTime) {
          nonceProps.initialTransaction = transaction
        }

        if (type === TRANSACTION_TYPE_RETRY) {
          nonceProps.hasRetried = true
        }

        if (type === TRANSACTION_TYPE_CANCEL) {
          nonceProps.hasCancelled = true
        }
      } else {
        nonceToTransactionsMap[nonce] = {
          nonce,
          transactions: [transaction],
          initialTransaction: transaction,
          primaryTransaction: transaction,
          hasRetried: transaction.type === TRANSACTION_TYPE_RETRY,
          hasCancelled: transaction.type === TRANSACTION_TYPE_CANCEL,
        }

        insertOrderedNonce(orderedNonces, nonce)
      }
    })

    const orderedTransactionGroups = orderedNonces.map((nonce) => nonceToTransactionsMap[nonce])
    mergeNonNonceTransactionGroups(orderedTransactionGroups, incomingTransactionGroups)
    return unapprovedTransactionGroups.concat(orderedTransactionGroups)
  },
)

/**
 * @name nonceSortedPendingTransactionsSelector
 * @description Returns an array of transactionGroups where transactions are still pending sorted by
 * nonce in descending order.
 * @returns {transactionGroup[]}
 */
export const nonceSortedPendingTransactionsSelector = createSelector(
  nonceSortedTransactionsSelector,
  (transactions = []) => (
    transactions.filter(({ primaryTransaction }) => primaryTransaction.status in PENDING_STATUS_HASH)
  ),
)

/**
 * @name nonceSortedCompletedTransactionsSelector
 * @description Returns an array of transactionGroups where transactions are confirmed sorted by
 * nonce in descending order.
 * @returns {transactionGroup[]}
 */
export const nonceSortedCompletedTransactionsSelector = createSelector(
  nonceSortedTransactionsSelector,
  (transactions = []) => (
    transactions
      .filter(({ primaryTransaction }) => !(primaryTransaction.status in PENDING_STATUS_HASH))
      .reverse()
  ),
)

export const submittedPendingTransactionsSelector = createSelector(
  transactionsSelector,
  (transactions = []) => (
    transactions.filter((transaction) => transaction.status === SUBMITTED_STATUS)
  ),
)
