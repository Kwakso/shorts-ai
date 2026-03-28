'use client'

import { useVideoPolling } from '@/lib/hooks/useVideoPolling'
import { useCallback } from 'react'
import { useProfile } from '@/lib/hooks/useProfile'
import { useVideos } from '@/lib/hooks/useVideos'
import { signOut } from '@/app/actions/auth'
import { useState } from 'react'

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: '초안',        color: '#6B7280', bg: '#1F2937' },
  generating: { label: '생성 중…',    color: '#F59E0B', bg: '#1C1A0F' },
  ready:      { label: '업로드 대기', color: '#3B82F6', bg: '#0F1C2E' },
  uploading:  { label: '업로드 중',   color: '#8B5CF6', bg: '#1A0F2E' },
  published:  { label: '게시 완료',   color: '#10B981', bg: '#0A1F17' },
  failed:     { label: '실패',        color: '#EF4444', bg: '#1F0A0A' },
}

const VIDEO_STYLES = [
  { value: 'cinematic',    label: '시네마틱',    emoji: '🎬' },
  { value: 'documentary',  label: '다큐멘터리',  emoji: '📽️' },
  { value: 'anime',        label: '애니메이션',  emoji: '✨' },
  { value: 'realistic',    label: '실사풍',      emoji: '📸' },
  { value: 'cartoon',      label: '카툰',        emoji: '🎨' },
  { value: 'abstract',     label: '추상적',      emoji: '🌀' },
]

export default function DashboardPage() {
  const { profile, creditInfo, loading: profileLoading } = useProfile()
  const { videos, loading: videosLoading, setVideos } = useVideos()

  const handleStatusChange = useCallback((id: string, status: string) => {
    setVideos(prev =>
      prev.map(v => v.id === id ? { ...v, status } : v)
    )
    if (status === 'ready') {
      showToast('🎉 영상 생성 완료! 업로드 준비가 됐습니다.')
    } else if (status === 'failed') {
      showToast('❌ 영상 생성에 실패했습니다.')
    }
  }, [])

  useVideoPolling(videos, handleStatusChange)
  const [topic, setTopic] = useState('')
  const [style, setStyle] = useState('cinematic')
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState<'generate' | 'videos'>('generate')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleGenerate() {
    if (!topic.trim() || generating) return
    if ((creditInfo?.balance ?? 0) < 1) {
      showToast('❌ 크레딧이 부족합니다.')
      return
    }

    setGenerating(true)
    try {
      const res = await fetch('/api/videos/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, style }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setTopic('')
      setActiveTab('videos')
      showToast('🚀 영상 생성이 시작되었습니다!')
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : '오류 발생'}`)
    } finally {
      setGenerating(false)
    }
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-[#060A0F] flex items-center justify-center">
        <div className="text-gray-500 text-sm animate-pulse">로딩 중...</div>
      </div>
    )
  }

  const balance = creditInfo?.balance ?? 0
  const maxCredits = creditInfo?.monthly_credit_limit ?? 10
  const creditPct = (balance / maxCredits) * 100
  const creditColor = creditPct > 50 ? '#10B981' : creditPct > 20 ? '#F59E0B' : '#EF4444'

  return (
    <div className="min-h-screen bg-[#060A0F] text-gray-100 pb-16"
      style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0D1117] border-b border-[#111827] px-5 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center text-sm font-bold">
            ▶
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-none">ShortsAI</div>
            <div className="text-[10px] text-gray-600 mt-0.5">YouTube Shorts 자동화</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* YT 연동 상태 */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
            profile?.yt_channel_id
              ? 'bg-[#0A1F17] border-green-900 text-green-400'
              : 'bg-[#1F0A0A] border-red-900 text-red-400'
          }`}>
            ▶ {profile?.yt_channel_name ?? '채널 미연동'}
          </div>

          {/* 크레딧 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[#1F2937] bg-[#111827]">
            ⚡ <span className="font-bold" style={{ color: creditColor }}>{balance}</span>
            <span className="text-gray-600">/ {maxCredits}</span>
          </div>

          {/* 아바타 + 로그아웃 */}
          <form action={signOut}>
            <button
              type="submit"
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-800 to-purple-900 flex items-center justify-center text-xs font-bold hover:opacity-80 transition-opacity"
              title="로그아웃"
            >
              {profile?.full_name?.[0] ?? profile?.email?.[0] ?? 'U'}
            </button>
          </form>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 border-b border-[#111827] bg-[#0D1117]">
        {[
          { label: '총 생성',   value: videos.length,                                    icon: '🎬' },
          { label: '처리 중',   value: videos.filter(v => v.status === 'generating').length, icon: '⚡' },
          { label: '게시 완료', value: videos.filter(v => v.status === 'published').length,  icon: '✅' },
        ].map((stat, i) => (
          <div key={i} className={`py-3 text-center ${i < 2 ? 'border-r border-[#111827]' : ''}`}>
            <div className="text-[10px] text-gray-600 mb-1">{stat.icon} {stat.label}</div>
            <div className="text-xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Credit Bar */}
      <div className="px-5 py-3 bg-[#0D1117] border-b border-[#111827]">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">크레딧</span>
          <span className="text-xs font-bold" style={{ color: creditColor }}>
            {balance} <span className="text-gray-600 font-normal">/ {maxCredits}</span>
          </span>
        </div>
        <div className="h-1 bg-[#1F2937] rounded-full">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${creditPct}%`, background: creditColor, boxShadow: `0 0 8px ${creditColor}88` }}
          />
        </div>
        {balance < 3 && (
          <p className="text-[11px] text-yellow-500 mt-2">⚠ 크레딧이 부족합니다. 충전이 필요합니다.</p>
        )}
      </div>

      {/* Tab Nav */}
      <div className="flex px-5 bg-[#0D1117] border-b border-[#111827]">
        {([
          { id: 'generate', label: '새 영상 생성' },
          { id: 'videos',   label: `내 영상 (${videos.length})` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 mr-5 text-sm border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400 font-semibold'
                : 'border-transparent text-gray-600 hover:text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-5 pt-5">

        {/* Generate Tab */}
        {activeTab === 'generate' && (
          <div className="space-y-4">
            <div>
              <div className="text-base font-bold text-white">쇼츠 영상 생성</div>
              <div className="text-xs text-gray-600 mt-1">Gemini AI + Kwai Sora2로 자동 생성</div>
            </div>

            <div className="bg-[#0D1117] border border-[#1F2937] rounded-xl p-5 space-y-4">
              {/* 주제 입력 */}
              <div>
                <label className="block text-[11px] text-gray-600 uppercase tracking-widest mb-2">주제 입력</label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="예) 옥천 로컬푸드 농부의 하루, AI가 바꾸는 미래 농업..."
                  rows={3}
                  className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 resize-none outline-none focus:border-[#374151] transition-colors"
                />
              </div>

              {/* 스타일 선택 */}
              <div>
                <label className="block text-[11px] text-gray-600 uppercase tracking-widest mb-2">영상 스타일</label>
                <div className="grid grid-cols-3 gap-2">
                  {VIDEO_STYLES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setStyle(s.value)}
                      className={`py-2.5 rounded-lg border text-xs transition-all flex flex-col items-center gap-1 ${
                        style === s.value
                          ? 'border-blue-600 bg-[#0F1C2E] text-blue-400 font-semibold'
                          : 'border-[#1F2937] bg-[#111827] text-gray-600 hover:border-[#374151]'
                      }`}
                    >
                      <span className="text-lg">{s.emoji}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 생성 버튼 */}
              <button
                onClick={handleGenerate}
                disabled={generating || !topic.trim() || balance < 1}
                className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: generating || !topic.trim() || balance < 1
                    ? '#1F2937'
                    : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                  color: generating || !topic.trim() || balance < 1 ? '#4B5563' : '#fff',
                  boxShadow: generating || !topic.trim() || balance < 1
                    ? 'none' : '0 4px 20px #7C3AED44',
                }}
              >
                {generating ? '⟳ 생성 중...' : balance < 1 ? '크레딧 부족' : '⚡ 쇼츠 생성 시작 (크레딧 1 사용)'}
              </button>
            </div>
          </div>
        )}

        {/* Videos Tab */}
        {activeTab === 'videos' && (
          <div className="space-y-3">
            <div>
              <div className="text-base font-bold text-white">내 영상</div>
              <div className="text-xs text-gray-600 mt-1">생성된 영상을 관리하고 업로드하세요</div>
            </div>

            {videosLoading ? (
              <div className="text-center py-10 text-gray-600 text-sm animate-pulse">로딩 중...</div>
            ) : videos.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">
                <div className="text-3xl mb-3">🎬</div>
                아직 생성된 영상이 없습니다
                <br />
                <button
                  onClick={() => setActiveTab('generate')}
                  className="mt-3 text-blue-500 text-xs underline"
                >
                  첫 영상 생성하기 →
                </button>
              </div>
            ) : (
              videos.map(video => {
                const s = STATUS_MAP[video.status] ?? STATUS_MAP.draft
                return (
                  <div
                    key={video.id}
                    className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-2 hover:border-[#374151] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#1F2937] flex items-center justify-center text-xl flex-shrink-0">
                        🎬
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-200 truncate">
                          {video.title ?? video.topic}
                        </div>
                        <div className="text-[11px] text-gray-600 mt-0.5">
                          {video.style} · {new Date(video.created_at).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                      <span
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border flex-shrink-0"
                        style={{ color: s.color, background: s.bg, borderColor: `${s.color}33` }}
                      >
                        {video.status === 'generating' && '● '}{s.label}
                      </span>
                    </div>

                    {video.status === 'published' && video.youtube_url && (
                    <a href={video.youtube_url} target="_blank" rel="noreferrer"
                        className="block text-center py-2 rounded-lg text-xs font-semibold border"
                        style={{ color: '#34D399', background: '#0A1F17', borderColor: '#10B98133' }}>
                        ↗ YouTube에서 보기
                    </a>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111827] border border-[#1F2937] rounded-xl px-5 py-2.5 text-sm text-gray-200 shadow-2xl z-50 whitespace-nowrap animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}