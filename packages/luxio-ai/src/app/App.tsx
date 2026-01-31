import { Sparkles, CirclePlus, CircleHelp, Send, FileText, Image, Link2, AlignLeft, ChevronDown } from 'lucide-react';


function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="text-purple-500">
              <Sparkles className="w-8 h-8 fill-purple-500" />
            </div>
            <h1 className="text-2xl">早上好，今天可以为您做些什么</h1>
          </div>
          {/* <img src={exampleImage} alt="Profile" className="w-10 h-10 rounded-full" /> */}
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* AI Mind Mapping Card */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg mb-2">AI 思维导图</h2>
            <p className="text-sm text-gray-500 mb-4">智能结构整理，快速理清思路</p>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>如何学习一门新语言</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>探讨传统行业在AI时代中的机遇</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>互联网产品的营销之道</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>周边必备物品</span>
              </div>
            </div>
          </div>

          {/* AI Flowchart Card */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg mb-2">AI 流程图</h2>
            <p className="text-sm text-gray-500 mb-4">自动生成标准图形，简化流程可视化</p>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>用户登录注册流程</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>图书馆教案流程网</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>中国近代史重大事件时间轴</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="text-gray-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3L13 8L8 13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span>新品开发关键里程碑甘特图</span>
              </div>
            </div>
          </div>

          {/* AI Efficiency Tools Card */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg mb-2">AI 效率工具</h2>
            <p className="text-sm text-gray-500 mb-4">快速生成图形表、文本、公式代码等</p>
            <div className="space-y-3">
              <button className="w-full flex items-center gap-3 p-3 rounded-lg bg-purple-50 hover:bg-purple-100 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-purple-200 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-600" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2L10 6H14L11 9L12 13L8 10L4 13L5 9L2 6H6L8 2Z"/>
                  </svg>
                </div>
                <span>Mermaid</span>
              </button>
              <button className="w-full flex items-center gap-3 p-3 rounded-lg bg-pink-50 hover:bg-pink-100 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-pink-200 flex items-center justify-center">
                  <svg className="w-4 h-4 text-pink-600" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="2"/>
                  </svg>
                </div>
                <span>LaTeX 方程式</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-4">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white shadow-sm">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" fill="currentColor"/>
              <circle cx="4" cy="4" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="4" r="1.5" fill="currentColor"/>
              <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
            </svg>
            <span>思维导图</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <rect x="10" y="2" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <rect x="2" y="10" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M6 4H10M4 6V10M12 6V10" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <span>流程图</span>
          </button>
        </div>

        {/* Input Area */}
        <div className="bg-white rounded-2xl shadow-sm border-2 border-purple-200 p-4">
          <div className="mb-4">
            <input
              type="text"
              placeholder="输入你的主题或问题"
              className="w-full text-lg outline-none"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 rounded-lg transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8L8 3L13 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 3V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>深度思考</span>
              </button>
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 rounded-lg transition-colors">
                <span>推荐场景</span>
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-gray-50 rounded-lg transition-colors" title="添加文档/PDF/音频">
                <CirclePlus className="w-5 h-5 text-gray-600" />
              </button>
              <button className="p-2 hover:bg-gray-50 rounded-lg transition-colors" title="帮助">
                <CircleHelp className="w-5 h-5 text-gray-600" />
              </button>
              <button className="p-2.5 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full hover:from-purple-500 hover:to-pink-500 transition-colors">
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center gap-4 mt-4 px-2 text-sm text-gray-600">
          <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
            <FileText className="w-4 h-4" />
            <span>文档/PDF/音频</span>
          </button>
          <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
            <Image className="w-4 h-4" />
            <span>图片描述</span>
          </button>
          <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
            <Link2 className="w-4 h-4" />
            <span>网页分析</span>
          </button>
          <button className="flex items-center gap-2 hover:text-gray-900 transition-colors">
            <AlignLeft className="w-4 h-4" />
            <span>总结长文本</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
