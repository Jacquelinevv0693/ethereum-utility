import Big from 'big.js'
import { BigNumber, Contract, providers, Wallet } from 'ethers'
import { readFile } from 'fs/promises'

export function makeBzz(decimalString) {
    return new Big(decimalString).mul(new Big(10).pow(16)).toString()
}

export function makeDai(decimalString) {
    return new Big(decimalString).mul(new Big(10).pow(18)).toString()
}

export async function unlockV3(path, password) {
    const json = await readFile(path, 'utf8')
    const wallet = await Wallet.fromEncryptedJson(json, password)
    const privateKey = wallet.privateKey
    const address = await wallet.getAddress()
    return { privateKey, address }
}

export async function privateKeyToAddress(privateKeyString) {
    const wallet = new Wallet(privateKeyString)
    const address = await wallet.getAddress()
    return address
}

const ABI = {
    uniswap: [
        {
            inputs: [
                {
                    internalType: 'uint256',
                    name: 'amountOutMin',
                    type: 'uint256'
                },
                {
                    internalType: 'address[]',
                    name: 'path',
                    type: 'address[]'
                },
                {
                    internalType: 'address',
                    name: 'to',
                    type: 'address'
                },
                {
                    internalType: 'uint256',
                    name: 'deadline',
                    type: 'uint256'
                }
            ],
            name: 'swapExactETHForTokens',
            outputs: [
                {
                    internalType: 'uint256[]',
                    name: 'amounts',
                    type: 'uint256[]'
                }
            ],
            stateMutability: 'payable',
            type: 'function'
        }
    ],
    bzz: [
        {
            type: 'function',
            stateMutability: 'nonpayable',
            payable: false,
            outputs: [
                {
                    type: 'bool',
                    name: ''
                }
            ],
            name: 'transfer',
            inputs: [
                {
                    type: 'address',
                    name: '_to'
                },
                {
                    type: 'uint256',
                    name: '_value'
                }
            ],
            constant: false
        },
        {
            constant: true,
            inputs: [
                {
                    name: '_owner',
                    type: 'address'
                }
            ],
            name: 'balanceOf',
            outputs: [
                {
                    name: 'balance',
                    type: 'uint256'
                }
            ],
            payable: false,
            type: 'function'
        }
    ]
}

export async function swap(privateKey, value, minimumReturnValue, jsonRpcProvider) {
    const signer = await makeReadySigner(privateKey, jsonRpcProvider)
    const gasLimit = 29000000
    const contract = new Contract('0x1C232F01118CB8B424793ae03F870aa7D0ac7f77', ABI.uniswap, signer)
    const WRAPPED_XDAI_CONTRACT = '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d'
    const BZZ_ON_XDAI_CONTRACT = '0xdbf3ea6f5bee45c02255b2c26a16f300502f68da'
    const response = await contract.swapExactETHForTokens(
        minimumReturnValue,
        [WRAPPED_XDAI_CONTRACT, BZZ_ON_XDAI_CONTRACT],
        await signer.getAddress(),
        Date.now(),
        { value, gasLimit }
    )

    return response
}

export async function drain(privateKey, to, rescuePrivateKey = null, jsonRpcProvider) {
    const DAI_IGNORE_THRESHOLD = makeDai('0.01')
    const DAI_RESCUE_VALUE = makeDai('0.1')
    const DAI_SAFE_SUB_VALUE = makeDai('0.008')
    const address = await privateKeyToAddress(privateKey)
    let dai = await getNativeBalance(address, jsonRpcProvider)
    const bzz = await getBzzBalance(address, jsonRpcProvider)
    if (BigNumber.from(dai).lt(DAI_IGNORE_THRESHOLD) && BigNumber.from(bzz).gt('0') && rescuePrivateKey) {
        await sendNativeTransaction(rescuePrivateKey, address, DAI_RESCUE_VALUE, jsonRpcProvider)
        dai = await getNativeBalance(address, jsonRpcProvider)
    }
    if (BigNumber.from(bzz).gt('0')) {
        await sendBzzTransaction(privateKey, to, bzz, jsonRpcProvider)
    }
    if (BigNumber.from(dai).gt(DAI_IGNORE_THRESHOLD)) {
        await sendNativeTransaction(
            privateKey,
            to,
            BigNumber.from(dai).sub(DAI_SAFE_SUB_VALUE).toString(),
            jsonRpcProvider
        )
    }
}

export async function getNativeBalance(address, jsonRpcProvider) {
    const provider = await makeReadyProvider(jsonRpcProvider)
    const bigNumberBalance = await provider.getBalance(address)
    return bigNumberBalance.toString()
}

export async function getBzzBalance(address, jsonRpcProvider) {
    const provider = await makeReadyProvider(jsonRpcProvider)
    const bzz = new Contract('0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da', ABI.bzz, provider)
    const bigNumberBalance = await bzz.balanceOf(address)
    return bigNumberBalance.toString()
}

export async function sendNativeTransaction(privateKey, to, value, jsonRpcProvider) {
    const signer = await makeReadySigner(privateKey, jsonRpcProvider)
    const gasPrice = await signer.getGasPrice()
    const transaction = await signer.sendTransaction({ to, value, gasPrice })
    const receipt = await transaction.wait(1)
    return { transaction, receipt }
}

export async function sendBzzTransaction(privateKey, to, value, jsonRpcProvider) {
    const signer = await makeReadySigner(privateKey, jsonRpcProvider)
    const gasPrice = await signer.getGasPrice()
    const bzz = new Contract('0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da', ABI.bzz, signer)
    const transaction = await bzz.transfer(to, value, { gasPrice })
    const receipt = await transaction.wait(1)
    return { transaction, receipt }
}

async function makeReadySigner(privateKey, jsonRpcProvider) {
    const provider = new providers.JsonRpcProvider(jsonRpcProvider, 100)
    await provider.ready
    const signer = new Wallet(privateKey, provider)
    return signer
}

async function makeReadyProvider(jsonRpcProvider) {
    const provider = new providers.JsonRpcProvider(jsonRpcProvider, 100)
    await provider.ready
    return provider
}
