import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = ''

// OKX Logo SVG
function OKXLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <rect width="36" height="36" rx="8" fill="#0d0d0d"/>
      <rect x="0.5" y="0.5" width="35" height="35" rx="7.5" stroke="#2a2a2a" strokeWidth="1"/>
      {/* Outer radar ring */}
      <circle cx="18" cy="18" r="12" stroke="#1d4ed8" strokeWidth="1" opacity="0.6"/>
      {/* Inner radar ring */}
      <circle cx="18" cy="18" r="7" stroke="#3b82f6" strokeWidth="1" opacity="0.8"/>
      {/* Cross hairs */}
      <line x1="18" y1="5" x2="18" y2="11" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="18" y1="25" x2="18" y2="31" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="5" y1="18" x2="11" y2="18" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="25" y1="18" x2="31" y2="18" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
      {/* Center dot */}
      <circle cx="18" cy="18" r="2.5" fill="#60a5fa"/>
      {/* Sweep line */}
      <line x1="18" y1="18" x2="27" y2="10" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
    </svg>
  )
}

// Market ticker bar - scrolling marquee
function TickerBar({ tickers }) {
  if (!tickers.length) return null
  const items = [...tickers, ...tickers]
  return (
    <div className="bg-[#0f0f0f] border-b border-[#1a1a1a] py-2 overflow-hidden relative group">
      <div className="flex" style={{
        animation: 'ticker-scroll 40s linear infinite',
        width: 'max-content'
      }}>
        {items.map((t, i) => (
          <a
            key={i}
            href={`https://www.okx.com/trade-spot/${t.symbol.toLowerCase()}-usdt`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 whitespace-nowrap px-6 hover:bg-[#1a1a1a] rounded cursor-pointer"
          >
            <span className="text-blue-400 font-medium text-xs">{t.symbol}</span>
            <span className="text-white font-mono text-xs">{t.price}</span>
            <span className={`text-xs font-mono ${
              parseFloat(t.change) >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {parseFloat(t.change) >= 0 ? '▲' : '▼'} {Math.abs(t.change)}%
            </span>
            <span className="text-[#2a2a2a] ml-4">|</span>
          </a>
        ))}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .group:hover > div {
          animation-play-state: paused !important;
        }
      `}</style>
    </div>
  )
}

// Message bubble
function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 flex-shrink-0 mt-1">
          <span className="text-black text-xs font-bold">AI</span>
        </div>
      )}
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-white text-black rounded-tr-sm'
          : 'bg-[#1a1a1a] text-white border border-[#2a2a2a] rounded-tl-sm'
      }`}>
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {msg.toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-500 font-mono bg-[#111] rounded px-2 py-1">
                <span className="text-green-400">⚡</span>
                <span>{tc}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        <p className="text-xs text-gray-500 mt-1">{msg.time}</p>
      </div>
    </div>
  )
}

// Suggested prompts
const SUGGESTIONS = [
  { icon: '📊', text: 'BTC现在价格多少？24小时涨跌如何？' },
  { icon: '📈', text: '查询ETH的RSI和MACD指标' },
  { icon: '💰', text: '显示BTC的资金费率和未平仓量' },
  { icon: '🔍', text: '分析SOL当前趋势，给出操作建议' },
  { icon: '⚡', text: '帮我查询前10大涨幅币种' },
  { icon: '🛡️', text: '查看BTC彩虹图和恐惧贪婪指数' },
]

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好，我是 X-Sentinel。\n\n搭载 OKX Agent Trade Kit，我可以实时查询市场数据、技术指标、资金费率，并协助你制定交易策略。\n\n有什么我可以帮你的？',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      toolCalls: []
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [tickers, setTickers] = useState([])
  const [activeTab, setActiveTab] = useState('chat')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    fetchTickers()
    const interval = setInterval(fetchTickers, 15000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function fetchTickers() {
    try {
      const res = await axios.get(`${API_URL}/api/tickers`)
      setTickers(res.data.data || [])
    } catch {}
  }

  async function sendMessage(text) {
    const userMsg = {
      role: 'user',
      content: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      toolCalls: []
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await axios.post(`${API_URL}/api/chat`, { message: text })
      const data = res.data
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        toolCalls: data.toolCalls || []
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ 请求失败，请稍后重试。',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        toolCalls: []
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim() || loading) return
    sendMessage(input.trim())
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="bg-[#0a0a0a] border-b border-[#1f1f1f] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <OKXLogo />
            <div>
              <h1 className="text-white font-semibold text-base leading-tight">X-Sentinel</h1>
              <p className="text-gray-500 text-xs">Powered by OKX Agent Trade Kit</p>
            </div>
          </div>
          <div className="flex bg-[#111] border border-[#222] rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1 rounded-md text-xs transition-all ${
                activeTab === 'chat' ? 'bg-white text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              对话
            </button>
            <button
              onClick={() => setActiveTab('market')}
              className={`px-3 py-1 rounded-md text-xs transition-all ${
                activeTab === 'market' ? 'bg-white text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              行情
            </button>
            <button
              onClick={() => setActiveTab('news')}
              className={`px-3 py-1 rounded-md text-xs transition-all ${
                activeTab === 'news' ? 'bg-white text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              新闻
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
          <span className="text-gray-400 text-xs">实时数据</span>
        </div>
      </header>

      {/* Ticker bar */}
      {tickers.length > 0 && <TickerBar tickers={tickers} />}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat area */}
        {activeTab === 'chat' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 chat-container">
              <div className="max-w-2xl mx-auto">
                {messages.map((msg, i) => (
                  <Message key={i} msg={msg} />
                ))}
                {loading && (
                  <div className="flex justify-start mb-4">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 flex-shrink-0">
                      <span className="text-black text-xs font-bold">AI</span>
                    </div>
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-5">
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}}></div>
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}}></div>
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}}></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Suggestions */}
            {messages.length <= 1 && (
              <div className="px-4 pb-3">
                <div className="max-w-2xl mx-auto">
                  <p className="text-gray-600 text-xs mb-2">快速开始</p>
                  <div className="grid grid-cols-2 gap-2">
                    {SUGGESTIONS.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(s.text)}
                        className="flex items-center gap-2 text-left px-3 py-2 bg-[#111] border border-[#222] rounded-xl text-xs text-gray-300 hover:border-[#444] hover:text-white transition-all"
                      >
                        <span>{s.icon}</span>
                        <span className="truncate">{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-4 pb-4 flex-shrink-0">
              <div className="max-w-2xl mx-auto">
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="输入任何交易问题，例如：BTC现在适合买入吗？"
                    className="flex-1 bg-[#111] border border-[#222] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#444] transition-colors"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="bg-white text-black px-4 py-3 rounded-xl text-sm font-medium hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex-shrink-0"
                  >
                    发送
                  </button>
                </form>
                <p className="text-gray-700 text-xs mt-2 text-center">OKX Agent Trade Kit · 83个工具覆盖完整交易生命周期</p>
              </div>
            </div>
          </div>
        )}

        {/* Market tab */}
        {activeTab === 'market' && (
          <MarketPanel />
        )}

        {/* News tab */}
        {activeTab === 'news' && (
          <NewsPanel />
        )}
      </div>
    </div>
  )
}

function NewsPanel() {
  const [news, setNews] = React.useState([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch('/api/news')
      .then(r => r.json())
      .then(d => { setNews(d.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-gray-600 text-sm">加载新闻...</div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-white font-semibold mb-4">加密市场动态</h2>
        <div className="space-y-3">
          {news.map((item, i) => (
            <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
              className="block bg-[#111] border border-[#1f1f1f] rounded-xl p-4 hover:border-[#444] hover:bg-[#161616] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {item.sentiment === 'bullish' && <span className="text-xs px-1.5 py-0.5 rounded bg-green-900 text-green-400 font-medium flex-shrink-0">利好</span>}
                    {item.sentiment === 'bearish' && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-400 font-medium flex-shrink-0">利空</span>}
                    {item.sentiment === 'neutral' && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-medium flex-shrink-0">中性</span>}
                    <p className="text-white text-sm font-medium leading-snug">{item.title}</p>
                  </div>
                  <p className="text-gray-500 text-xs">{item.source} · {item.time}</p>
                </div>
                <span className="text-blue-400 text-xs flex-shrink-0 mt-1">阅读 →</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function MarketPanel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMarket()
    const interval = setInterval(fetchMarket, 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchMarket() {
    try {
      const res = await axios.get('/api/market')
      setData(res.data.data)
    } catch {}
    setLoading(false)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-gray-600 text-sm">加载行情数据...</div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-white font-semibold mb-4">实时行情</h2>
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.map((item, i) => (
              <a key={i} href={`https://www.okx.com/zh-hans/trade-swap/${item.symbol.toLowerCase()}-usdt-swap`} target="_blank" rel="noopener noreferrer" className="bg-[#111] border border-[#1f1f1f] rounded-xl p-4 hover:border-[#444] hover:bg-[#161616] transition-colors block">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-blue-400 font-medium">{item.symbol}</span>
                  <span className={`text-sm font-mono ${
                    item.change >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {item.change >= 0 ? '+' : ''}{item.change}%
                  </span>
                </div>
                <p className="text-2xl font-mono text-white">${item.price}</p>
                <div className="flex justify-between mt-1"><p className="text-xs text-gray-500">成交量 {item.volume}</p><p className="text-xs text-blue-400 opacity-50">合约 →</p></div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
