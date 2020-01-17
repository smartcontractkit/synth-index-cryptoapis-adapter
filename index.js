const rp = require('request-promise');
const snx = require('synthetix');
const Decimal = require('decimal.js');

const getPriceData = async (offset) => {
    return rp({
        url: `https://api.cryptoapis.io/v1/assets?limit=500&skip=${offset}`,
        headers: {
            'X-API-KEY': process.env.API_KEY
        },
        json: true
    })
};

const calculateIndex = (indexes) => {
    let value = new Decimal(0);
    indexes.forEach(i => {
        const price = i.priceData.price;
        if (price <= 0)
            throw "invalid price";
        value = value.plus(new Decimal(i.units).times(new Decimal(price)))
    });
    return value.toNumber()
};

const createRequest = async (input, callback) => {
    const asset = input.data.asset || 'sCEX';
    const datas = snx.getSynths({network: 'mainnet'}).filter(({index, inverted}) => index && !inverted);
    const data = datas.find(d => d.name.toLowerCase() === asset.toLowerCase());

    let results = [];
    while (true) {
        const priceDataQuery = await getPriceData(results.length);
        results.push(...priceDataQuery.payload);
        if (priceDataQuery.meta.totalCount <= results.length)
            break;
    }

    await Promise.all(data.index.map(async (synth) => {
        synth.priceData = results.find(d => typeof d.originalSymbol !== "undefined" && d.originalSymbol.toLowerCase() === synth.symbol.toLowerCase())
    })).catch(err => {
        callback(500, {
            jobRunID: input.id,
            status: 'errored',
            error: err,
            statusCode: 500
        })
    });

    try {
        data.result = calculateIndex(data.index);
    } catch (e) {
        callback(500, {
            jobRunID: input.id,
            status: 'errored',
            error: "failed getting price",
            statusCode: 500
        });
        return
    }

    callback(200, {
        jobRunID: input.id,
        data: data,
        result: data.result,
        statusCode: 200
    })
};

exports.gcpservice = (req, res) => {
    createRequest(req.body, (statusCode, data) => {
        res.status(statusCode).send(data)
    })
};

exports.handler = (event, context, callback) => {
    createRequest(event, (statusCode, data) => {
        callback(null, data)
    })
};

exports.handlerv2 = (event, context, callback) => {
    createRequest(JSON.parse(event.body), (statusCode, data) => {
        callback(null, {
            statusCode: statusCode,
            body: JSON.stringify(data),
            isBase64Encoded: false
        })
    })
};

module.exports.createRequest = createRequest;
