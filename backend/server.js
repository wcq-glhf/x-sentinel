const express = require('express')
const { exec } = require('child_process')
const { promisify } = require('util')
const cors = require('cors')
const path = require('path')

const execAsync = promisify(exec)
const app = express()
const PORT = process.env.PORT || 3456

app.use(cors())
app.use(express.json())

// Serve frontend build
app.use(express.static(path.join(__dirname, '../frontend/dist')))

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runOKX(cmd) {
  try {
    const { stdout } = await execAsync(`okx ${cmd} 2>&1`, { timeout: 15000 })
    return stdout.trim()
  } catch (err) {
    return err.stdout?.trim() || err.message
  }
}

// ─── Technical Indicators (self-computed from candle data) ────────────────────

async function getCandles(instId, bar = '1H', limit = 100) {
  const out = await runOKX(`market candles ${instId} --bar ${bar} --limit ${limit} --json`)
  try {
    const json = JSON.parse(out)
    // candles: [ts, open, high, low, close, vol, volCcy]
    return (Array.isArray(json) ? json : []).map(c => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5])
    })).reverse() // oldest first
  } catch { return [] }
}

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return null
  const closes = candles.map(c => c.close)
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

function calcEMA(closes, period) {
  const k = 2 / (period + 1)
  let ema = closes[0]
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
  }
  return ema
}

function calcMACD(candles) {
  if (candles.length < 26) return null
  const closes = candles.map(c => c.close)
  // EMA12, EMA26
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10
  let ema12 = closes[0], ema26 = closes[0]
  const macdLine = []
  for (let i = 1; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12)
    ema26 = closes[i] * k26 + ema26 * (1 - k26)
    macdLine.push(ema12 - ema26)
  }
  // Signal line (EMA9 of MACD)
  let signal = macdLine[0]
  for (let i = 1; i < macdLine.length; i++) {
    signal = macdLine[i] * k9 + signal * (1 - k9)
  }
  const macd = macdLine[macdLine.length - 1]
  const histogram = macd - signal
  return {
    macd: parseFloat(macd.toFixed(4)),
    signal: parseFloat(signal.toFixed(4)),
    histogram: parseFloat(histogram.toFixed(4))
  }
}

function calcBollingerBands(candles, period = 20) {
  if (candles.length < period) return null
  const closes = candles.slice(-period).map(c => c.close)
  const ma = closes.reduce((a, b) => a + b, 0) / period
  const std = Math.sqrt(closes.reduce((a, b) => a + Math.pow(b - ma, 2), 0) / period)
  return {
    upper: parseFloat((ma + 2 * std).toFixed(2)),
    middle: parseFloat(ma.toFixed(2)),
    lower: parseFloat((ma - 2 * std).toFixed(2)),
    bandwidth: parseFloat(((4 * std) / ma * 100).toFixed(2))
  }
}

// BTC Rainbow price zones (log-scale based approximation)
function getBTCRainbowZone(price) {
  const zones = [
    { max: 20000, label: '蓝色区域', desc: '极度低估，历史性买入机会', color: '🔵' },
    { max: 40000, label: '绿色区域', desc: '低估，适合逐步买入', color: '🟢' },
    { max: 60000, label: '黄绿区域', desc: '合理估值下沿，可持有', color: '🟡' },
    { max: 80000, label: '黄色区域', desc: '合理估值，中性区间', color: '🟨' },
    { max: 100000, label: '橙色区域', desc: '开始高估，注意风险', color: '🟠' },
    { max: 150000, label: '红色区域', desc: '明显高估，考虑减仓', color: '🔴' },
    { max: Infinity, label: '深红区域', desc: '极度泡沫，历史性卖出区', color: '🟥' },
  ]
  return zones.find(z => price < z.max) || zones[zones.length - 1]
}

async function computeIndicators(instId) {
  const candles = await getCandles(instId, '1H', 100)
  if (candles.length < 14) return null
  const rsi = calcRSI(candles)
  const macd = calcMACD(candles)
  const bb = calcBollingerBands(candles)
  const lastClose = candles[candles.length - 1].close
  return { rsi, macd, bb, lastClose }
}

function parseIntent(message) {
  const msg = message.toLowerCase()
  const tools = []
  const commands = []

  // Identity / greeting - short-circuit everything
  if (msg.match(/你是谁|你叫什么|介绍.*自己|自我介绍|你是什么|你是做什么|你干嘛|你能做什么|你有什么功能|你的功能|你会什么|你能干嘛|什么结构|你是|who are you|what are you|what can you do/)) {
    return { tools: [], commands: [{ type: 'identity' }], coins: [] }
  }

  // General chat / non-market questions - short-circuit
  if (msg.match(/感觉|好的|谢谢|不错|厉害|哈哈|好用|怎么样|加油|测试|hello|hi$|嗯|好吧|明白|知道了|懂了/)) {
    return { tools: [], commands: [{ type: 'chat' }], coins: [] }
  }

  // Coin detection - check full message
  const coinMap = {
    'btc': 'BTC', 'bitcoin': 'BTC',
    'eth': 'ETH', 'ethereum': 'ETH', '以太': 'ETH',
    'sol': 'SOL', 'solana': 'SOL',
    'bnb': 'BNB',
    'xrp': 'XRP', 'ripple': 'XRP',
    'doge': 'DOGE', 'dogecoin': 'DOGE',
    'ada': 'ADA', 'cardano': 'ADA',
    'avax': 'AVAX', 'avalanche': 'AVAX',
    'dot': 'DOT', 'polkadot': 'DOT',
    'link': 'LINK', 'chainlink': 'LINK',
    'uni': 'UNI', 'uniswap': 'UNI',
    'atom': 'ATOM', 'cosmos': 'ATOM',
    'ltc': 'LTC', 'litecoin': 'LTC',
    'ton': 'TON',
    'matic': 'MATIC', 'polygon': 'MATIC',
    'trx': 'TRX', 'tron': 'TRX',
  }
  const foundCoins = []
  for (const [key, val] of Object.entries(coinMap)) {
    if (msg.includes(key)) foundCoins.push(val)
  }
  const coins = foundCoins.length > 0 ? [...new Set(foundCoins)] : ['BTC']

  const isTrend = msg.match(/趋势|trend|建议|分析|适合|买|卖|应该|操作|方向|怎么看/)
  const isPrice = msg.match(/价格|price|ticker|行情|涨跌|多少钱|现在/)
  const isIndicator = msg.match(/rsi|macd|ema|均线|技术指标|indicator|布林/)
  const isFunding = msg.match(/资金费率|funding/)
  const isOI = msg.match(/未平仓|open interest|持仓量/)
  const isGainers = msg.match(/涨幅|gainers|top|前.*名|排行/)
  const isOnchain = msg.match(/彩虹|rainbow|ahr999|恐惧|贪婪|fear|greed|mayer/)

  // Trend analysis: fetch ticker + indicators
  if (isTrend) {
    coins.forEach(c => {
      tools.push(`okx market ticker ${c}-USDT --json`)
      tools.push(`okx market candles ${c}-USDT --bar 1H --limit 24`)
      commands.push({ type: 'trend', coin: c })
    })
  }

  if (isPrice && !isTrend && !isGainers) {
    coins.forEach(c => {
      tools.push(`okx market ticker ${c}-USDT --json`)
      commands.push({ type: 'ticker', coin: c })
    })
  }

  if (isIndicator) {
    coins.forEach(c => {
      tools.push(`okx market indicator ${c}-USDT --type RSI`)
      tools.push(`okx market indicator ${c}-USDT --type MACD`)
      commands.push({ type: 'indicator', coin: c })
    })
  }

  if (isFunding) {
    coins.forEach(c => {
      tools.push(`okx market funding-rate ${c}-USDT-SWAP`)
      commands.push({ type: 'funding', coin: c })
    })
  }

  if (isOI) {
    coins.forEach(c => {
      tools.push(`okx market open-interest ${c}-USDT-SWAP`)
      commands.push({ type: 'oi', coin: c })
    })
  }

  if (isGainers) {
    tools.push(`okx market tickers SPOT --json`)
    commands.push({ type: 'gainers' })
  }

  if (isOnchain) {
    tools.push(`okx market indicator BTC-USDT --type AHR999`)
    commands.push({ type: 'onchain' })
  }

  // Default: ticker
  if (commands.length === 0) {
    coins.forEach(c => {
      tools.push(`okx market ticker ${c}-USDT --json`)
      commands.push({ type: 'ticker', coin: c })
    })
  }

  return { tools, commands, coins }
}

async function generateResponse(message, rawData, toolCalls, indicators = null, coins = ['BTC']) {
  const msg = message.toLowerCase()
  const isTrend = msg.match(/趋势|trend|建议|分析|适合|买|卖|应该|操作|方向|怎么看/)

  // Identity / chat response
  if (rawData.length === 0 && toolCalls.length === 0) {
    const msg = message.toLowerCase()
    if (msg.match(/你是谁|你叫什么|介绍.*自己|自我介绍|你是什么|你是做什么|你干嘛|你能做什么|你有什么功能|你的功能|你会什么|你能干嘛|什么结构|你是|who are you|what are you|what can you do/)) {
      return `我是 X-Sentinel，由 X-Global 战略情报部署的交易情报系统。

搭载 OKX Agent Trade Kit，我可以：
• 📊 实时查询主流币种行情（BTC、ETH、SOL、OKB 等）
• 📈 计算 RSI、MACD、布林带等技术指标
• 💰 分析资金费率与未平仓量
• 🔍 趋势研判与操作参考
• 🌈 BTC 彩虹图与市场情绪
• 🚀 24h 涨幅榜 TOP 10

试试问我：「BTC 现在适合买入吗？」或「查 ETH 的 RSI 指标」`
    }
    // General chat fallback
    const chatResponses = [
      '收到。有什么市场数据需要查询，直接说币种和需求。',
      '明白。需要行情分析、技术指标或趋势建议，随时告诉我。',
      '好的。可以问我任何主流币种的价格、RSI、MACD 或操作建议。'
    ]
    return chatResponses[Math.floor(Math.random() * chatResponses.length)]
  }

  // Gainers handler (must be first to avoid ticker short-circuit)
  for (const { cmd, output } of rawData) {
    if (cmd.includes('tickers') && output) {
      try {
        const json = JSON.parse(output)
        const arr = Array.isArray(json) ? json : []
        const top10 = arr
          .filter(t => t.instId && t.instId.endsWith('-USDT') && t.last && t.open24h)
          .map(t => ({
            symbol: t.instId.replace('-USDT', ''),
            last: parseFloat(t.last),
            change: ((parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h) * 100)
          }))
          .filter(t => !isNaN(t.change) && t.last > 0)
          .sort((a, b) => b.change - a.change)
          .slice(0, 10)

        if (top10.length > 0) {
          let response = `🚀 24h涨幅榜 TOP 10\n\n`
          top10.forEach((t, i) => {
            const changeStr = (t.change >= 0 ? '+' : '') + t.change.toFixed(2) + '%'
            response += `${i + 1}.  ${t.symbol.padEnd(10)} $${t.last.toLocaleString().padStart(12)}  ${changeStr}\n`
          })
          const avg = top10.reduce((a, b) => a + b.change, 0) / top10.length
          response += `\n💡 X-Sentinel AI 总结\n`
          response += `• 强势板块平均涨幅 +${avg.toFixed(2)}%，做多情绪偏强\n`
          response += `• 领涨 ${top10[0].symbol} +${top10[0].change.toFixed(2)}%，关注是否有催化剂驱动\n`
          response += `• 追高需谨慎，建议结合成交量和RSI判断入场时机\n`
          response += `\n⚠️ 数据来源：OKX实时行情，不构成投资建议。`
          return response
        }
      } catch {}
    }
  }

  // Parse ticker data
  let tickerData = null
  for (const { cmd, output } of rawData) {
    if (cmd.includes('ticker') && output) {
      try {
        const json = JSON.parse(output)
        const d = Array.isArray(json) ? json[0] : json
        if (d && d.last) {
          const last = parseFloat(d.last)
          const open24h = parseFloat(d.open24h)
          const high24h = parseFloat(d.high24h)
          const low24h = parseFloat(d.low24h)
          const change = ((last - open24h) / open24h * 100)
          tickerData = { last, open24h, high24h, low24h, change, instId: d.instId }
        }
      } catch {}
    }
  }

  if (tickerData) {
    const { last, high24h, low24h, change, instId } = tickerData
    const symbol = instId?.replace('-USDT', '') || '?'
    const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + '%'
    const range = ((high24h - low24h) / low24h * 100).toFixed(2)
    const position = Math.round((last - low24h) / (high24h - low24h) * 100)

    let response = `📊 ${symbol}/USDT 实时行情\n`
    response += `当前价格：$${last.toLocaleString()}\n`
    response += `24h涨跌：${changeStr}\n`
    response += `24h最高：$${high24h.toLocaleString()}  最低：$${low24h.toLocaleString()}\n`
    response += `价格位置：处于24h区间的 ${position}% 位置\n`

    if (isTrend) {
      response += `\n📈 趋势分析\n`
      if (change > 3) {
        response += `• 动量：强势上涨，24h涨幅 ${changeStr}，多头主导\n`
      } else if (change > 0) {
        response += `• 动量：温和上涨，市场偏多但力度有限\n`
      } else if (change > -3) {
        response += `• 动量：小幅回调，空头略占优势\n`
      } else {
        response += `• 动量：明显下跌，空头压力较大\n`
      }

      if (position > 80) {
        response += `• 位置：价格接近24h高点区域，短期有压力\n`
      } else if (position > 50) {
        response += `• 位置：价格在区间上半段，多头偏强\n`
      } else if (position > 20) {
        response += `• 位置：价格在区间下半段，空头偏强\n`
      } else {
        response += `• 位置：价格接近24h低点，关注支撑是否有效\n`
      }

      response += `• 波动率：24h振幅 ${range}%，`
      if (parseFloat(range) > 5) {
        response += `波动较大，注意仓位控制\n`
      } else {
        response += `波动适中，市场相对平稳\n`
      }

      response += `\n💡 操作参考\n`
      if (change > 2 && position < 70) {
        response += `• 趋势偏多，可考虑逢回调轻仓做多\n`
        response += `• 支撑参考：$${(low24h * 1.005).toFixed(2)}，止损设于 $${low24h.toLocaleString()} 下方\n`
        response += `• 压力参考：$${high24h.toLocaleString()}，突破后可加仓\n`
      } else if (change < -2 && position > 30) {
        response += `• 趋势偏空，建议观望或轻仓做空\n`
        response += `• 压力参考：$${(high24h * 0.995).toFixed(2)}，止损设于 $${high24h.toLocaleString()} 上方\n`
        response += `• 支撑参考：$${low24h.toLocaleString()}，跌破需警惕\n`
      } else {
        response += `• 当前趋势不明朗，建议观望为主\n`
        response += `• 等待价格突破 $${high24h.toLocaleString()} 或跌破 $${low24h.toLocaleString()} 再入场\n`
      }

      // Append indicators if available
      if (indicators) {
        response += `\n\n🔬 技术指标（1H）\n`
        if (indicators.rsi !== null) {
          const rsiLevel = indicators.rsi > 70 ? '超买⚠️' : indicators.rsi < 30 ? '超卖💡' : '中性'
          response += `• RSI(14)：${indicators.rsi}  ${rsiLevel}\n`
        }
        if (indicators.macd) {
          const trend = indicators.macd.histogram > 0 ? '多头发散📈' : '空头发散📉'
          response += `• MACD：${indicators.macd.macd}  信号线：${indicators.macd.signal}  柱状：${indicators.macd.histogram}  ${trend}\n`
        }
        if (indicators.bb) {
          const bb = indicators.bb
          const pos = indicators.lastClose > bb.upper ? '突破上轨' : indicators.lastClose < bb.lower ? '跌破下轨' : '轨道内运行'
          response += `• 布林带：上${bb.upper} / 中${bb.middle} / 下${bb.lower}  带宽${bb.bandwidth}%  当前${pos}\n`
        }
        if (indicators.rainbow) {
          const r = indicators.rainbow
          response += `\n🌈 BTC彩虹图\n• 当前区域：${r.color} ${r.label}\n• 信号：${r.desc}\n`
        }
      }

      response += `\n⚠️ 以上为技术面分析，不构成投资建议。请结合基本面和自身风险承受能力决策。`
    } else if (indicators && !isTrend) {
      // Pure indicator query
      const symbol = coins[0]
      let response = `🔬 ${symbol}/USDT 技术指标（1H K线计算）\n\n`
      if (indicators.rsi !== null) {
        const rsiLevel = indicators.rsi > 70 ? '超买区间，注意回调风险⚠️' : indicators.rsi < 30 ? '超卖区间，关注反弹机会💡' : '中性区间，无明显超买超卖'
        response += `📊 RSI(14)：${indicators.rsi}\n• ${rsiLevel}\n\n`
      }
      if (indicators.macd) {
        const { macd, signal, histogram } = indicators.macd
        const trend = histogram > 0 ? 'MACD上穿信号线，短期多头信号📈' : 'MACD下穿信号线，短期空头信号📉'
        response += `📊 MACD\n• MACD线：${macd}\n• 信号线：${signal}\n• 柱状图：${histogram}\n• ${trend}\n\n`
      }
      if (indicators.bb) {
        const { upper, middle, lower, bandwidth } = indicators.bb
        const price = indicators.lastClose
        const pos = price > upper ? '价格突破上轨，超买信号，注意回调' : price < lower ? '价格跌破下轨，超卖信号，关注反弹' : `价格在轨道内运行（$${price}）`
        response += `📊 布林带(20)\n• 上轨：$${upper}\n• 中轨：$${middle}\n• 下轨：$${lower}\n• 带宽：${bandwidth}%\n• ${pos}\n\n`
      }
      if (indicators.rainbow) {
        const r = indicators.rainbow
        response += `🌈 BTC彩虹图\n• 当前区域：${r.color} ${r.label}\n• 信号：${r.desc}\n\n`
      }
      response += `⚠️ 以上指标由OKX Agent Trade Kit实时K线数据计算，不构成投资建议。`
      return response
    }

    return response
  }

  // Pure indicator query without ticker
  if (indicators) {
    const symbol = coins[0]
    let response = `🔬 ${symbol}/USDT 技术指标（1H K线计算）\n\n`
    if (indicators.rsi !== null) {
      const rsiLevel = indicators.rsi > 70 ? '超买区间，注意回调风险⚠️' : indicators.rsi < 30 ? '超卖区间，关注反弹机会💡' : '中性区间'
      response += `📊 RSI(14)：${indicators.rsi}  ${rsiLevel}\n`
    }
    if (indicators.macd) {
      const { macd, signal, histogram } = indicators.macd
      response += `📊 MACD：${macd}  信号：${signal}  柱：${histogram}  ${histogram > 0 ? '多头📈' : '空头📉'}\n`
    }
    if (indicators.bb) {
      response += `📊 布林带：上${indicators.bb.upper} 中${indicators.bb.middle} 下${indicators.bb.lower}\n`
    }
    if (indicators.rainbow) {
      const r = indicators.rainbow
      response += `🌈 彩虹图：${r.color} ${r.label} — ${r.desc}\n`
    }
    response += `\n⚠️ 数据由OKX ATK实时K线计算，不构成投资建议。`
    return response
  }

  // Gainers handler
  for (const { cmd, output } of rawData) {
    if (cmd.includes('tickers') && output) {
      try {
        const json = JSON.parse(output)
        const arr = Array.isArray(json) ? json : []
        const top10 = arr
          .filter(t => t.instId && t.instId.endsWith('-USDT') && t.last && t.open24h)
          .map(t => ({
            symbol: t.instId.replace('-USDT', ''),
            last: parseFloat(t.last),
            change: ((parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h) * 100)
          }))
          .filter(t => !isNaN(t.change) && t.last > 0)
          .sort((a, b) => b.change - a.change)
          .slice(0, 10)

        let response = `🚀 24h涨幅榜 TOP 10\n\n`
        top10.forEach((t, i) => {
          response += `${i + 1}. ${t.symbol.padEnd(10)} $${t.last.toLocaleString()}  +${t.change.toFixed(2)}%\n`
        })
        response += `\n💡 X-Sentinel AI 总结\n`
        const avg = top10.reduce((a, b) => a + b.change, 0) / top10.length
        response += `• 今日强势板块平均涨幅 +${avg.toFixed(2)}%，市场做多情绪偏强\n`
        const topCoin = top10[0]
        response += `• 领涨币种 ${topCoin.symbol} 涨幅 +${topCoin.change.toFixed(2)}%，关注是否有催化剂\n`
        response += `• 建议关注成交量配合情况，追高需谨慎\n`
        response += `\n⚠️ 数据来源：OKX ATK 实时行情，不构成投资建议。`
        return response
      } catch {}
    }
  }

  // Fallback
  const lines = []
  rawData.forEach(({ cmd, output }) => {
    if (output && output.length > 0) lines.push(`[${cmd}]\n${output}`)
  })
  const raw = lines.join('\n\n') || '暂时无法获取该数据，请稍后重试。'
  return raw
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })

  try {
    const { tools, commands, coins } = parseIntent(message)
    const msg = message.toLowerCase()
    const toolCallsUsed = []

    // Execute OKX CLI commands
    const results = await Promise.all(
      tools.map(async cmd => ({
        cmd: cmd.replace('okx ', ''),
        output: await runOKX(cmd.replace('okx ', ''))
      }))
    )
    toolCallsUsed.push(...tools.map(t => t.replace('okx ', '')))

    // Compute indicators if requested
    let indicatorData = null
    if (msg.match(/rsi|macd|ema|均线|技术指标|indicator|布林|彩虹|rainbow|恐惧|贪婪|fear|greed|趋势|trend|建议|分析|操作|方向/)) {
      const coin = coins[0]
      const instId = `${coin}-USDT`
      toolCallsUsed.push(`market candles ${instId} --bar 1H --limit 100 [计算RSI/MACD/布林]`)
      indicatorData = await computeIndicators(instId)

      // BTC rainbow
      if (coin === 'BTC' && msg.match(/彩虹|rainbow|ahr999|恐惧|贪婪/)) {
        if (indicatorData) indicatorData.rainbow = getBTCRainbowZone(indicatorData.lastClose)
      }
    }

    const response = await generateResponse(message, results, toolCallsUsed, indicatorData, coins)

    res.json({ response, toolCalls: toolCallsUsed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Tickers for header bar
app.get('/api/tickers', async (req, res) => {
  try {
    const symbols = [
      'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT',
      'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'DOT-USDT', 'LINK-USDT',
      'UNI-USDT', 'ATOM-USDT', 'LTC-USDT', 'TON-USDT', 'OKB-USDT'
    ]
    const results = await Promise.all(
      symbols.map(async s => {
        const out = await runOKX(`market ticker ${s} --json`)
        try {
          const json = JSON.parse(out)
          const d = Array.isArray(json) ? json[0] : json
          const last = parseFloat(d.last)
          const open24h = parseFloat(d.open24h)
          const change = ((last - open24h) / open24h * 100).toFixed(2)
          return {
            symbol: s.replace('-USDT', ''),
            price: last.toLocaleString('en-US', { maximumFractionDigits: 4 }),
            change: parseFloat(change)
          }
        } catch {
          return null
        }
      })
    )
    res.json({ data: results.filter(Boolean) })
  } catch (err) {
    res.json({ data: [] })
  }
})

// Market overview
app.get('/api/market', async (req, res) => {
  try {
    const symbols = [
      'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT',
      'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'DOT-USDT', 'LINK-USDT',
      'UNI-USDT', 'ATOM-USDT', 'LTC-USDT', 'TON-USDT', 'OKB-USDT'
    ]
    const results = await Promise.all(
      symbols.map(async s => {
        const out = await runOKX(`market ticker ${s} --json`)
        try {
          const json = JSON.parse(out)
          const d = Array.isArray(json) ? json[0] : json
          const last = parseFloat(d.last)
          const open24h = parseFloat(d.open24h)
          const change = ((last - open24h) / open24h * 100).toFixed(2)
          const vol = (parseFloat(d.volCcy24h) / 1e6).toFixed(1) + 'M'
          return {
            symbol: s.replace('-USDT', ''),
            price: last.toLocaleString('en-US', { maximumFractionDigits: 4 }),
            change: parseFloat(change),
            volume: vol
          }
        } catch {
          return null
        }
      })
    )
    res.json({ data: results.filter(Boolean) })
  } catch (err) {
    res.json({ data: [] })
  }
})

// News API - CoinDesk RSS
app.get('/api/news', async (req, res) => {
  try {
    const { execSync } = require('child_process')
    const data = execSync('curl -sL --max-time 10 -A "Mozilla/5.0" "https://feeds.feedburner.com/CoinDesk"', { encoding: 'utf8' })
    const items = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    const titleRe = /<title><!\[CDATA\[([^\]]+)\]\]><\/title>/
    const linkRe = /<link>([^<]+)<\/link>/
    const pubRe = /<pubDate>([^<]+)<\/pubDate>/
    const authorRe = /<dc:creator>([^<]+)<\/dc:creator>/
    let m
    while ((m = itemRe.exec(data)) !== null && items.length < 20) {
      const block = m[1]
      const title = (block.match(titleRe) || [])[1]
      const url = (block.match(linkRe) || [])[1]
      const pub = (block.match(pubRe) || [])[1]
      const author = (block.match(authorRe) || [])[1] || 'CoinDesk'
      if (title && url) {
        const t = pub ? new Date(pub).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
        const titleLower = title.toLowerCase()
        let sentiment = 'neutral'
        const bullish = ['rise', 'rises', 'surge', 'surges', 'gain', 'gains', 'rally', 'bullish', 'high', 'record', 'adopt', 'launch', 'approve', 'approval', 'buy', 'growth', 'tokenize', 'partnership', 'deal', 'invest', 'up', 'breakthrough', 'soar', 'jump', 'boost']
        const bearish = ['fall', 'falls', 'drop', 'drops', 'crash', 'dumps', 'bearish', 'low', 'ban', 'hack', 'exploit', 'scam', 'fraud', 'sell', 'loss', 'risk', 'warn', 'fear', 'decline', 'plunge', 'sink', 'collapse', 'down', 'trouble', 'probe', 'sue', 'lawsuit']
        if (bullish.some(w => titleLower.includes(w))) sentiment = 'bullish'
        else if (bearish.some(w => titleLower.includes(w))) sentiment = 'bearish'
        items.push({ title: title.trim(), url: url.trim(), source: author.trim(), time: t, sentiment })
      }
    }
    res.json({ data: items })
  } catch (err) {
    res.json({ data: [] })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`OKX Trading Copilot backend running on port ${PORT}`)
})
