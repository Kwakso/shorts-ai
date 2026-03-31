'use client'

import { useVideoPolling } from '@/lib/hooks/useVideoPolling'
import { useCallback, useState, useEffect } from 'react'
import { useProfile } from '@/lib/hooks/useProfile'
import { useVideos } from '@/lib/hooks/useVideos'
import { signOut } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────
interface YoutubeChannel {
  id: string
  channel_id: string
  channel_name: string
  channel_thumbnail: string | null
  is_default: boolean
  created_at: string
}

interface BatchResult {
  topic: string
  success: boolean
  error?: string
}

// ─── Constants ────────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: '초안',        color: '#6B7280', bg: '#1F2937' },
  generating: { label: '생성 중…',    color: '#F59E0B', bg: '#1C1A0F' },
  ready:      { label: '업로드 대기', color: '#3B82F6', bg: '#0F1C2E' },
  uploading:  { label: '업로드 중',   color: '#8B5CF6', bg: '#1A0F2E' },
  published:  { label: '게시 완료',   color: '#10B981', bg: '#0A1F17' },
  failed:     { label: '실패',        color: '#EF4444', bg: '#1F0A0A' },
}

const VIDEO_STYLES = [
  { value: 'cinematic',   label: '시네마틱',   emoji: '🎬' },
  { value: 'documentary', label: '다큐멘터리', emoji: '📽️' },
  { value: 'anime',       label: '애니메이션', emoji: '✨' },
  { value: 'realistic',   label: '실사풍',     emoji: '📸' },
  { value: 'cartoon',     label: '카툰',       emoji: '🎨' },
  { value: 'abstract',    label: '추상적',     emoji: '🌀' },
]

// ─── Main Component ───────────────────────────────────────────
export default function DashboardPage() {
  const { profile, creditInfo, loading: profileLoading } = useProfile()
  const { videos, loading: videosLoading, setVideos } = useVideos()

  // 기본 state
  const [topic, setTopic] = useState('')
  const [style, setStyle] = useState('cinematic')
  const [generating, setGenerating] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'generate' | 'videos' | 'channels'>('generate')
  const [toast, setToast] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  // 영상 타입 state (ai | stock)
  const [videoType, setVideoType] = useState<'ai' | 'stock'>('stock')

  // 배치 생성 state
  const [batchMode, setBatchMode] = useState(false)
  const [batchTopics, setBatchTopics] = useState('')
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    total: number
    successCount: number
    failCount: number
    results: BatchResult[]
  } | null>(null)

  // 채널 state
  const [channels, setChannels] = useState<YoutubeChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

  // ─── 채널 로드 ────────────────────────────────────────────
  useEffect(() => {
    async function fetchChannels() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('youtube_channels')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      setChannels(data ?? [])
      setChannelsLoading(false)

      const defaultCh = data?.find((c: YoutubeChannel) => c.is_default)
      if (defaultCh) setSelectedChannelId(defaultCh.id)
    }
    fetchChannels()
  }, [])

  // ─── 유틸 ────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const handleStatusChange = useCallback((id: string, status: string) => {
    setVideos(prev => prev.map(v => v.id === id ? { ...v, status } : v))
    if (status === 'ready') showToast('🎉 영상 생성 완료! 업로드 준비가 됐습니다.')
    else if (status === 'failed') showToast('❌ 영상 생성에 실패했습니다.')
  }, [setVideos])

  useVideoPolling(videos, handleStatusChange)

  // ─── 단일 영상 생성 ──────────────────────────────────────
  async function handleGenerate() {
    if (!topic.trim() || generating) return
    if (balance < 1) {
      showToast('❌ 크레딧이 부족합니다.')
      return
    }
    setGenerating(true)
    try {
      // 영상 타입에 따라 API 분기
      const apiUrl = videoType === 'stock'
        ? '/api/videos/generate-stock'
        : '/api/videos/generate'

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, style }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTopic('')
      setActiveTab('videos')
      showToast(`🚀 ${videoType === 'stock' ? '스톡' : 'AI'} 영상 생성이 시작되었습니다!`)
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : '오류 발생'}`)
    } finally {
      setGenerating(false)
    }
  }

  // ─── 배치 영상 생성 ──────────────────────────────────────
  async function handleBatchGenerate() {
    const topics = batchTopics
      .split('\n')
      .map(t => t.trim())
      .filter(t => t.length > 0)

    if (topics.length === 0) { showToast('❌ 주제를 입력해 주세요.'); return }
    if (topics.length > 20) { showToast('❌ 한 번에 최대 20개까지 가능합니다.'); return }
    if (balance < topics.length) {
      showToast(`❌ 크레딧 부족 (필요: ${topics.length}, 보유: ${balance})`)
      return
    }

    setBatchGenerating(true)
    setBatchResult(null)

    try {
      const res = await fetch('/api/videos/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics, style, videoType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setBatchResult({
        total: data.total,
        successCount: data.successCount,
        failCount: data.failCount,
        results: data.results,
      })

      setBatchTopics('')
      setActiveTab('videos')
      showToast(`🚀 ${data.successCount}개 영상 생성 시작!`)
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : '오류 발생'}`)
    } finally {
      setBatchGenerating(false)
    }
  }

  // ─── YouTube 업로드 ──────────────────────────────────────
  async function handleUpload(videoId: string) {
    if (channels.length === 0 && !profile?.yt_channel_id) {
      showToast('❌ YouTube 채널 연동이 필요합니다.')
      return
    }
    setUploadingId(videoId)
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, status: 'uploading' } : v))
    try {
      const res = await fetch(`/api/videos/${videoId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: selectedChannelId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setVideos(prev => prev.map(v =>
        v.id === videoId ? { ...v, status: 'published', youtube_url: data.youtubeUrl } : v
      ))
      showToast('🎉 YouTube 업로드 완료!')
    } catch (err) {
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, status: 'ready' } : v))
      showToast(`❌ ${err instanceof Error ? err.message : '업로드 실패'}`)
    } finally {
      setUploadingId(null)
    }
  }

  // ─── 채널 관리 ───────────────────────────────────────────
  async function handleSetDefault(channelId: string) {
    const res = await fetch('/api/channels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    })
    if (res.ok) {
      setChannels(prev => prev.map(c => ({ ...c, is_default: c.id === channelId })))
      setSelectedChannelId(channelId)
      showToast('✅ 기본 채널이 변경되었습니다.')
    }
  }

  async function handleDeleteChannel(channelId: string) {
    const res = await fetch('/api/channels', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    })
    if (res.ok) {
      setChannels(prev => prev.filter(c => c.id !== channelId))
      if (selectedChannelId === channelId) setSelectedChannelId(null)
      showToast('🗑 채널이 삭제되었습니다.')
    }
  }

  // ─── 로딩 ────────────────────────────────────────────────
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
  const defaultChannel = channels.find(c => c.is_default) ?? channels[0]
  const batchTopicCount = batchTopics.split('\n').filter(t => t.trim()).length

  return (
    <div
      className="min-h-screen bg-[#060A0F] text-gray-100 pb-16"
      style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
    >
      {/* ── Header ── */}
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
          <a
            href="/api/auth/youtube"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border cursor-pointer transition-colors ${
              defaultChannel || profile?.yt_channel_id
                ? 'bg-[#0A1F17] border-green-900 text-green-400 hover:border-green-700'
                : 'bg-[#1F0A0A] border-red-900 text-red-400 hover:border-red-600'
            }`}
          >
            ▶ {defaultChannel?.channel_name ?? profile?.yt_channel_name ?? '채널 미연동 — 클릭하여 연결'}
          </a>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[#1F2937] bg-[#111827]">
            ⚡ <span className="font-bold" style={{ color: creditColor }}>{balance}</span>
            <span className="text-gray-600">/ {maxCredits}</span>
          </div>

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

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 border-b border-[#111827] bg-[#0D1117]">
        {[
          { label: '총 생성',   value: videos.length,                                       icon: '🎬' },
          { label: '처리 중',   value: videos.filter(v => v.status === 'generating').length, icon: '⚡' },
          { label: '게시 완료', value: videos.filter(v => v.status === 'published').length,  icon: '✅' },
        ].map((stat, i) => (
          <div key={i} className={`py-3 text-center ${i < 2 ? 'border-r border-[#111827]' : ''}`}>
            <div className="text-[10px] text-gray-600 mb-1">{stat.icon} {stat.label}</div>
            <div className="text-xl font-bold text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* ── Credit Bar ── */}
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

      {/* ── Tab Nav ── */}
      <div className="flex px-5 bg-[#0D1117] border-b border-[#111827]">
        {([
          { id: 'generate', label: '영상 생성' },
          { id: 'videos',   label: `내 영상 (${videos.length})` },
          { id: 'channels', label: `채널 (${channels.length})` },
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

      {/* ── Content ── */}
      <div className="px-5 pt-5">

        {/* ── Generate Tab ── */}
        {activeTab === 'generate' && (
          <div className="space-y-4">
            <div>
              <div className="text-base font-bold text-white">쇼츠 영상 생성</div>
              <div className="text-xs text-gray-600 mt-1">Gemini AI + Kling 또는 Pexels 스톡 영상으로 자동 생성</div>
            </div>

            {/* ── 영상 타입 선택 ── */}
            <div className="flex gap-2 p-1 bg-[#111827] rounded-lg border border-[#1F2937]">
              <button
                onClick={() => setVideoType('stock')}
                className={`flex-1 py-2.5 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  videoType === 'stock'
                    ? 'bg-[#0A1F17] text-green-400 border border-green-800'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                📹 스톡 영상
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${videoType === 'stock' ? 'bg-green-900 text-green-300' : 'bg-[#1F2937] text-gray-600'}`}>
                  고품질
                </span>
              </button>
              <button
                onClick={() => setVideoType('ai')}
                className={`flex-1 py-2.5 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  videoType === 'ai'
                    ? 'bg-[#1E3A5F] text-blue-400 border border-blue-800'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                🤖 AI 영상
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${videoType === 'ai' ? 'bg-blue-900 text-blue-300' : 'bg-[#1F2937] text-gray-600'}`}>
                  Kling
                </span>
              </button>
            </div>

            {/* 선택된 타입 설명 */}
            {videoType === 'stock' ? (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-[#0A1F17] border border-green-900 rounded-lg">
                <span className="text-green-400 text-sm mt-0.5">✓</span>
                <div>
                  <div className="text-xs font-semibold text-green-400">Pexels 스톡 영상 방식</div>
                  <div className="text-[11px] text-green-700 mt-0.5">실사 고품질 영상 + TTS 나레이션 + 자막 자동 합성 (30~60초)</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-[#0F1C2E] border border-blue-900 rounded-lg">
                <span className="text-blue-400 text-sm mt-0.5">✓</span>
                <div>
                  <div className="text-xs font-semibold text-blue-400">Kling AI 영상 방식</div>
                  <div className="text-[11px] text-blue-700 mt-0.5">AI가 프롬프트로 영상 생성 (5~10초, 크레딧 소모)</div>
                </div>
              </div>
            )}

            {/* ── 단일/배치 모드 전환 ── */}
            <div className="flex gap-2 p-1 bg-[#111827] rounded-lg border border-[#1F2937]">
              <button
                onClick={() => setBatchMode(false)}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
                  !batchMode
                    ? 'bg-[#1E3A5F] text-blue-400 border border-blue-800'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                단일 생성
              </button>
              <button
                onClick={() => setBatchMode(true)}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
                  batchMode
                    ? 'bg-[#1E3A5F] text-blue-400 border border-blue-800'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                배치 생성 (여러 개)
              </button>
            </div>

            <div className="bg-[#0D1117] border border-[#1F2937] rounded-xl p-5 space-y-4">

              {/* 단일 생성 */}
              {!batchMode && (
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
              )}

              {/* 배치 생성 */}
              {batchMode && (
                <div>
                  <label className="block text-[11px] text-gray-600 uppercase tracking-widest mb-2">
                    주제 목록 (한 줄에 하나씩, 최대 20개)
                  </label>
                  <textarea
                    value={batchTopics}
                    onChange={e => setBatchTopics(e.target.value)}
                    placeholder={`옥천 로컬푸드 농부의 하루\n아파트 에어컨 청소 꿀팁\nAI가 바꾸는 미래 농업\n여름 건강관리 방법\n컴퓨터 분해 청소하기`}
                    rows={8}
                    className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 resize-none outline-none focus:border-[#374151] transition-colors"
                  />
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[11px] text-gray-600">
                      {batchTopicCount}개 입력됨
                      {batchTopicCount > 20 && <span className="text-red-400 ml-1">최대 20개 초과!</span>}
                    </span>
                    <span className="text-[11px]" style={{ color: balance >= batchTopicCount ? '#6B7280' : '#EF4444' }}>
                      필요 크레딧: {batchTopicCount} / 보유: {balance}
                    </span>
                  </div>
                </div>
              )}

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

              {/* 채널 선택 (2개 이상일 때) */}
              {channels.length > 1 && (
                <div>
                  <label className="block text-[11px] text-gray-600 uppercase tracking-widest mb-2">업로드 채널</label>
                  <select
                    value={selectedChannelId ?? ''}
                    onChange={e => setSelectedChannelId(e.target.value)}
                    className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-[#374151] transition-colors"
                  >
                    {channels.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        {ch.channel_name} {ch.is_default ? '(기본)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 생성 버튼 */}
              {!batchMode ? (
                <button
                  onClick={handleGenerate}
                  disabled={generating || !topic.trim() || balance < 1}
                  className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: generating || !topic.trim() || balance < 1
                      ? '#1F2937'
                      : videoType === 'stock'
                        ? 'linear-gradient(135deg, #059669, #0284C7)'
                        : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                    color: generating || !topic.trim() || balance < 1 ? '#4B5563' : '#fff',
                    boxShadow: generating || !topic.trim() || balance < 1
                      ? 'none'
                      : videoType === 'stock' ? '0 4px 20px #05966944' : '0 4px 20px #7C3AED44',
                  }}
                >
                  {generating
                    ? '⟳ 생성 중...'
                    : balance < 1
                    ? '크레딧 부족'
                    : videoType === 'stock'
                    ? '📹 스톡 영상 생성 시작 (크레딧 1 사용)'
                    : '🤖 AI 영상 생성 시작 (크레딧 1 사용)'}
                </button>
              ) : (
                <button
                  onClick={handleBatchGenerate}
                  disabled={batchGenerating || batchTopicCount === 0 || batchTopicCount > 20 || balance < batchTopicCount}
                  className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: batchGenerating || batchTopicCount === 0 || balance < batchTopicCount
                      ? '#1F2937'
                      : videoType === 'stock'
                        ? 'linear-gradient(135deg, #059669, #0284C7)'
                        : 'linear-gradient(135deg, #059669, #2563EB)',
                    color: batchGenerating || batchTopicCount === 0 || balance < batchTopicCount ? '#4B5563' : '#fff',
                  }}
                >
                  {batchGenerating
                    ? '⟳ 배치 생성 중...'
                    : batchTopicCount === 0 ? '주제를 입력해 주세요'
                    : balance < batchTopicCount ? `크레딧 부족 (${batchTopicCount - balance}개 부족)`
                    : `⚡ ${batchTopicCount}개 일괄 생성 (크레딧 ${batchTopicCount}개 사용)`}
                </button>
              )}
            </div>

            {/* 배치 결과 */}
            {batchResult && (
              <div className="bg-[#0D1117] border border-[#1F2937] rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="text-sm font-bold text-white">배치 생성 결과</div>
                  <div className="text-xs text-gray-600">
                    성공 <span className="text-green-400 font-bold">{batchResult.successCount}</span>
                    {' / '}
                    실패 <span className="text-red-400 font-bold">{batchResult.failCount}</span>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {batchResult.results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span>{r.success ? '✅' : '❌'}</span>
                      <span className={`flex-1 truncate ${r.success ? 'text-gray-300' : 'text-gray-600'}`}>
                        {r.topic}
                      </span>
                      {r.error && <span className="text-red-400 text-[10px] truncate">{r.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Videos Tab ── */}
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
                <button onClick={() => setActiveTab('generate')} className="mt-3 text-blue-500 text-xs underline">
                  첫 영상 생성하기 →
                </button>
              </div>
            ) : (
              videos.map(video => {
                const s = STATUS_MAP[video.status] ?? STATUS_MAP.draft
                const isUploading = uploadingId === video.id
                const isPreviewOpen = previewId === video.id
                const isStock = (video as any).video_type === 'stock'
                return (
                  <div
                    key={video.id}
                    className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden hover:border-[#374151] transition-colors"
                  >
                    {/* 영상 미리보기 */}
                    {isPreviewOpen && video.storage_url && (
                      <div className="bg-black w-full flex items-center justify-center">
                        <video
                          src={video.storage_url}
                          controls
                          autoPlay
                          playsInline
                          className="w-full object-contain"
                          style={{ maxHeight: 300 }}
                        />
                      </div>
                    )}

                    <div className="p-4 space-y-2">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => video.storage_url && setPreviewId(isPreviewOpen ? null : video.id)}
                          className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 transition-colors ${
                            video.storage_url
                              ? 'bg-blue-900 hover:bg-blue-800 cursor-pointer'
                              : 'bg-[#1F2937] cursor-default'
                          }`}
                        >
                          {video.storage_url ? (isPreviewOpen ? '⏸' : '▶') : '🎬'}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-200 truncate">
                            {video.title ?? video.topic}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5 flex items-center gap-1.5">
                            <span>{video.style}</span>
                            <span>·</span>
                            <span>{new Date(video.created_at).toLocaleDateString('ko-KR')}</span>
                            {isStock && (
                              <span className="px-1.5 py-0.5 rounded bg-[#0A1F17] border border-green-900 text-green-500 text-[10px]">
                                📹 스톡
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-full border flex-shrink-0"
                          style={{ color: s.color, background: s.bg, borderColor: `${s.color}33` }}
                        >
                          {video.status === 'generating' && '● '}{s.label}
                        </span>
                      </div>

                      {/* TTS 나레이션 미리듣기 */}
                      {(video as any).audio_url && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-[#0D1117] rounded-lg border border-[#1F2937]">
                          <span className="text-[11px] text-gray-600 flex-shrink-0">🎙 나레이션</span>
                          <audio
                            src={(video as any).audio_url}
                            controls
                            className="flex-1 h-7"
                            style={{ minWidth: 0 }}
                          />
                        </div>
                      )}

                      {/* 업로드 대기 버튼 */}
                      {video.status === 'ready' && (
                        <button
                          onClick={() => handleUpload(video.id)}
                          disabled={isUploading}
                          className="w-full py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 hover:bg-blue-900"
                          style={{ color: '#60A5FA', background: '#0F1C2E', borderColor: '#3B82F633' }}
                        >
                          ▲ YouTube 쇼츠로 업로드
                        </button>
                      )}

                      {/* 업로드 중 */}
                      {video.status === 'uploading' && (
                        <div
                          className="w-full py-2 rounded-lg text-xs font-semibold border text-center"
                          style={{ color: '#A78BFA', background: '#1A0F2E', borderColor: '#8B5CF633' }}
                        >
                          ⟳ YouTube 업로드 중...
                        </div>
                      )}

                      {/* 게시 완료 */}
                      {video.status === 'published' && video.youtube_url && (
                        <a
                          href={video.youtube_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-center py-2 rounded-lg text-xs font-semibold border hover:opacity-80 transition-opacity"
                          style={{ color: '#34D399', background: '#0A1F17', borderColor: '#10B98133' }}
                        >
                          ↗ YouTube에서 보기
                        </a>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── Channels Tab ── */}
        {activeTab === 'channels' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-base font-bold text-white">YouTube 채널 관리</div>
                <div className="text-xs text-gray-600 mt-1">채널을 추가하고 기본 채널을 설정하세요</div>
              </div>
              <a
                href="/api/auth/youtube"
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#0F1C2E] border border-blue-900 text-blue-400 hover:border-blue-600 transition-colors"
              >
                + 채널 추가
              </a>
            </div>

            {channelsLoading ? (
              <div className="text-center py-10 text-gray-600 text-sm animate-pulse">로딩 중...</div>
            ) : channels.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">
                <div className="text-3xl mb-3">📺</div>
                연동된 채널이 없습니다
                <br />
                <a href="/api/auth/youtube" className="mt-3 text-blue-500 text-xs underline block">
                  채널 추가하기 →
                </a>
              </div>
            ) : (
              channels.map(channel => (
                <div
                  key={channel.id}
                  className={`bg-[#111827] border rounded-xl p-4 flex items-center gap-3 transition-colors cursor-pointer ${
                    selectedChannelId === channel.id
                      ? 'border-blue-700'
                      : 'border-[#1F2937] hover:border-[#374151]'
                  }`}
                  onClick={() => setSelectedChannelId(channel.id)}
                >
                  {channel.channel_thumbnail ? (
                    <img
                      src={channel.channel_thumbnail}
                      alt={channel.channel_name}
                      className="w-10 h-10 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#1F2937] flex items-center justify-center text-xl flex-shrink-0">
                      📺
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-200 truncate">
                      {channel.channel_name}
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5 truncate">
                      {channel.channel_id}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {channel.is_default ? (
                      <span className="text-[11px] px-2 py-1 rounded-full bg-[#0A1F17] border border-green-900 text-green-400">
                        기본
                      </span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); handleSetDefault(channel.id) }}
                        className="text-[11px] px-2 py-1 rounded-full border border-[#1F2937] text-gray-600 hover:border-blue-900 hover:text-blue-400 transition-colors"
                      >
                        기본 설정
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteChannel(channel.id) }}
                      className="text-[11px] px-2 py-1 rounded-full border border-[#1F2937] text-gray-600 hover:border-red-900 hover:text-red-400 transition-colors"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111827] border border-[#1F2937] rounded-xl px-5 py-2.5 text-sm text-gray-200 shadow-2xl z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}
