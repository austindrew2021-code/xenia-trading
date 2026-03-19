import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

type DiscoverTab = 'discover' | 'following' | 'news' | 'announcements' | 'events';

interface Post { id:string; user_id:string; username:string; content:string; likes:number; comments_count:number; created_at:string; tags?:string[]; is_announcement:boolean; }
interface NewsItem { title:string; url:string; source:string; published_on:number; imageurl:string; body:string; }
interface Event { id:string; title:string; description:string; reward:string; starts_at:string; ends_at:string; participants_count:number; max_participants:number|null; status:string; }

const TABS: { id:DiscoverTab; label:string; icon:string }[] = [
  { id:'discover',      label:'Discover',      icon:'🌐' },
  { id:'following',     label:'Following',     icon:'👥' },
  { id:'news',          label:'News',          icon:'📰' },
  { id:'announcements', label:'Announcements', icon:'📢' },
  { id:'events',        label:'Events',        icon:'🎯' },
];

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function PostCard({ post, liked, onLike, onFollow, following }: { post:Post; liked:boolean; onLike:(id:string)=>void; onFollow:(uid:string)=>void; following:string[]; }) {
  const { user } = useAuth();
  const isFollowing = following.includes(post.user_id);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.1] transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2BFFF1] to-[#A78BFA] flex items-center justify-center font-bold text-sm text-[#05060B] flex-shrink-0">
            {(post.username || 'U')[0].toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-bold text-[#F4F6FA]">{post.username ?? 'Anonymous'}</p>
            <p className="text-[10px] text-[#4B5563]">{timeAgo(post.created_at)}</p>
          </div>
        </div>
        {user && user.id !== post.user_id && (
          <button onClick={() => onFollow(post.user_id)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex-shrink-0 ${isFollowing ? 'border-white/[0.08] text-[#4B5563]' : 'border-[#2BFFF1]/30 text-[#2BFFF1] hover:bg-[#2BFFF1]/10'}`}>
            {isFollowing ? 'Following' : '+ Follow'}
          </button>
        )}
      </div>
      <p className="text-sm text-[#A7B0B7] leading-relaxed mb-3">{post.content}</p>
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {post.tags.map(t => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[#2BFFF1]/10 text-[#2BFFF1] border border-[#2BFFF1]/15">#{t}</span>)}
        </div>
      )}
      <div className="flex items-center gap-4 text-[11px] text-[#4B5563]">
        <button onClick={() => onLike(post.id)}
          className={`flex items-center gap-1.5 hover:text-red-400 transition-colors ${liked ? 'text-red-400' : ''}`}>
          {liked ? '❤️' : '🤍'} {post.likes}
        </button>
        <span className="flex items-center gap-1.5">💬 {post.comments_count}</span>
      </div>
    </div>
  );
}

function NewsCard({ item }: { item:NewsItem }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] transition-all overflow-hidden">
      <div className="flex gap-3 p-4">
        {item.imageurl && (
          <img src={item.imageurl} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
            onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="text-sm font-bold text-[#F4F6FA] leading-snug line-clamp-2 hover:text-[#2BFFF1] transition-colors flex-1">
              {item.title}
            </a>
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#2BFFF1]/10 text-[#2BFFF1] border border-[#2BFFF1]/20 hover:bg-[#2BFFF1]/20 transition-all whitespace-nowrap">
              {item.source} ↗
            </a>
          </div>
          <p className="text-[11px] text-[#6B7280] line-clamp-2 mb-2">{item.body}</p>
          <p className="text-[10px] text-[#374151]">{new Date(item.published_on*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event, registered, onRegister }: { event:Event; registered:boolean; onRegister:(id:string)=>void; }) {
  const { user } = useAuth();
  const now = new Date();
  const ends = new Date(event.ends_at);
  const isActive = event.status === 'active' && ends > now;
  const full = event.max_participants !== null && event.participants_count >= event.max_participants;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 hover:border-white/[0.12] transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-[#4B5563]/20 text-[#4B5563]'}`}>
              {isActive ? '● LIVE' : event.status.toUpperCase()}
            </span>
            {registered && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25">✓ Registered</span>}
          </div>
          <p className="font-bold text-[#F4F6FA] text-base">{event.title}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[#F59E0B] font-bold text-sm">{event.reward}</p>
          <p className="text-[10px] text-[#4B5563]">Reward</p>
        </div>
      </div>
      <p className="text-sm text-[#A7B0B7] mb-4 leading-relaxed">{event.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
          <span>👥 {event.participants_count}{event.max_participants ? `/${event.max_participants}` : ''}</span>
          <span>· Ends {new Date(event.ends_at).toLocaleDateString()}</span>
        </div>
        {user && isActive && !registered && !full && (
          <button onClick={() => onRegister(event.id)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
            Join Now →
          </button>
        )}
        {full && !registered && <span className="text-xs text-[#4B5563]">Full</span>}
        {!user && <span className="text-xs text-[#4B5563]">Sign in to join</span>}
      </div>
    </div>
  );
}

export function DiscoverPage({ initialTab }: { initialTab?: string }) {
  const { user, account } = useAuth();
  const [tab,          setTab]          = useState<DiscoverTab>((initialTab as DiscoverTab) ?? 'discover');
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [news,         setNews]         = useState<NewsItem[]>([]);
  const [events,       setEvents]       = useState<Event[]>([]);
  const [liked,        setLiked]        = useState<Set<string>>(new Set());
  const [following,    setFollowing]    = useState<string[]>([]);
  const [registered,   setRegistered]   = useState<Set<string>>(new Set());
  const [newPost,      setNewPost]      = useState('');
  const [posting,      setPosting]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [newsLoading,  setNewsLoading]  = useState(true);

  // Load posts
  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    let q = supabase.from('community_posts').select('*').order('created_at', { ascending:false }).limit(30);
    if (tab === 'following' && user && following.length > 0) q = q.in('user_id', following);
    if (tab === 'following' && user && following.length === 0) { setPosts([]); setLoading(false); return; }
    if (tab === 'announcements') q = q.eq('is_announcement', true);
    else if (tab === 'discover') q = q.eq('is_announcement', false);
    const { data } = await q;
    setPosts((data as Post[]) ?? []);
    setLoading(false);
  }, [tab, user, following]);

  // Load news — via Supabase Edge Function proxy (server-side, no CORS issues)
  const loadNews = useCallback(async () => {
    setNewsLoading(true);
    setNews([]);

    const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL
      || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

    // Primary: Supabase Edge Function proxy (no CORS, server-side fetch)
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/crypto-news`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d.news) && d.news.length > 0) {
          setNews(d.news);
          setNewsLoading(false);
          return;
        }
      }
    } catch { /* fall through */ }

    // Fallback: direct CryptoCompare (works in some environments)
    try {
      const r2 = await fetch(
        'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=25&sortOrder=latest'
      );
      if (r2.ok) {
        const d2 = await r2.json();
        if (Array.isArray(d2.Data) && d2.Data.length > 0) {
          setNews(d2.Data);
          setNewsLoading(false);
          return;
        }
      }
    } catch { /* fall through */ }

    // Fallback: CoinTelegraph via allorigins CORS proxy
    try {
      const ct = encodeURIComponent('https://cointelegraph.com/rss');
      const r3 = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${ct}&count=20&api_key=`);
      if (r3.ok) {
        const d3 = await r3.json();
        if (Array.isArray(d3.items) && d3.items.length > 0) {
          setNews(d3.items.map((item:any) => ({
            title: item.title, url: item.link, source: 'CoinTelegraph',
            body: (item.description||'').replace(/<[^>]*>/g,'').slice(0,220),
            published_on: Math.floor(new Date(item.pubDate).getTime()/1000),
            imageurl: item.thumbnail || '',
          })));
          setNewsLoading(false);
          return;
        }
      }
    } catch { /* all failed */ }

    setNewsLoading(false);
  }, []);

  // Load events
  const loadEvents = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending:false });
    setEvents((data as Event[]) ?? []);
    if (user) {
      const { data: regs } = await supabase.from('event_registrations').select('event_id').eq('user_id', user.id);
      setRegistered(new Set((regs ?? []).map((r:any) => r.event_id)));
    }
  }, [user]);

  // Load user's follows and likes
  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from('community_follows').select('following_id').eq('follower_id', user.id)
      .then(({ data }) => setFollowing((data ?? []).map((r:any) => r.following_id)));
    supabase.from('community_likes').select('post_id').eq('user_id', user.id)
      .then(({ data }) => setLiked(new Set((data ?? []).map((r:any) => r.post_id))));
  }, [user]);

  useEffect(() => {
    if (tab === 'news') { loadNews(); }
    else if (tab === 'events') loadEvents();
    else loadPosts();
  }, [tab, loadPosts, loadNews, loadEvents]);

  const handleLike = async (postId: string) => {
    if (!supabase || !user) return;
    const isLiked = liked.has(postId);
    if (isLiked) {
      await supabase.from('community_likes').delete().eq('user_id', user.id).eq('post_id', postId);
      await supabase.from('community_posts').update({ likes: posts.find(p=>p.id===postId)!.likes - 1 }).eq('id', postId);
      setLiked(prev => { const n = new Set(prev); n.delete(postId); return n; });
    } else {
      await supabase.from('community_likes').insert({ user_id:user.id, post_id:postId });
      await supabase.from('community_posts').update({ likes: posts.find(p=>p.id===postId)!.likes + 1 }).eq('id', postId);
      setLiked(prev => new Set([...prev, postId]));
    }
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: p.likes + (isLiked ? -1 : 1) } : p));
  };

  const handleFollow = async (uid: string) => {
    if (!supabase || !user) return;
    const isFollowing = following.includes(uid);
    if (isFollowing) {
      await supabase.from('community_follows').delete().eq('follower_id', user.id).eq('following_id', uid);
      setFollowing(prev => prev.filter(id => id !== uid));
    } else {
      await supabase.from('community_follows').insert({ follower_id:user.id, following_id:uid });
      setFollowing(prev => [...prev, uid]);
    }
  };

  const handleRegister = async (eventId: string) => {
    if (!supabase || !user) return;
    await supabase.from('event_registrations').insert({ event_id:eventId, user_id:user.id });
    await supabase.from('events').update({ participants_count: events.find(e=>e.id===eventId)!.participants_count + 1 }).eq('id', eventId);
    setRegistered(prev => new Set([...prev, eventId]));
    setEvents(prev => prev.map(e => e.id===eventId ? { ...e, participants_count:e.participants_count+1 } : e));
  };

  const submitPost = async () => {
    if (!supabase || !user || !newPost.trim()) return;
    setPosting(true);
    const tags = (newPost.match(/#\w+/g) ?? []).map(t => t.slice(1));
    const { error: postErr } = await supabase.from('community_posts').insert({
      user_id: user.id,
      username: account?.username ?? 'Anonymous',
      content: newPost,
      tags,
      likes: 0,
      comments_count: 0,
      is_announcement: false,
      is_admin: false,
    });
    if (postErr) console.error('Post error:', postErr.message);
    setNewPost('');
    await loadPosts();
    setPosting(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 pt-4 overflow-x-auto flex-shrink-0 pb-3 border-b border-white/[0.06]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab === t.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-24 md:pb-4">

        {/* Post composer */}
        {(tab === 'discover') && user && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2BFFF1] to-[#A78BFA] flex items-center justify-center font-bold text-sm text-[#05060B] flex-shrink-0">
                {(account?.username || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <textarea value={newPost} onChange={e => setNewPost(e.target.value)}
                  placeholder="Share your trading thoughts… use #hashtags"
                  rows={2}
                  className="w-full bg-transparent text-sm text-[#F4F6FA] placeholder-[#374151] outline-none resize-none" />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-[#4B5563]">{newPost.length}/280</span>
                  <button onClick={submitPost} disabled={posting || !newPost.trim()}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                    {posting ? '…' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading && (tab !== 'news') && (
          <div className="flex items-center justify-center py-12 gap-2 text-[#4B5563]">
            <div className="w-4 h-4 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
          </div>
        )}

        {(tab === 'discover' || tab === 'following' || tab === 'announcements') && !loading && (
          posts.length === 0
            ? <div className="text-center py-12 text-[#4B5563] text-sm">
                {tab === 'following' ? 'Follow some traders to see their posts here' : 'No posts yet. Be the first to share!'}
              </div>
            : posts.map(p => (
                <PostCard key={p.id} post={p} liked={liked.has(p.id)}
                  onLike={handleLike} onFollow={handleFollow} following={following} />
              ))
        )}

        {tab === 'news' && (
          newsLoading
            ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#4B5563]">
                <div className="w-8 h-8 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
                <span className="text-sm">Loading crypto news…</span>
              </div>
            )
            : news.length === 0
              ? (
                <div className="text-center py-16 text-[#4B5563]">
                  <p className="text-base mb-2">📰</p>
                  <p className="text-sm">Could not load news. Check your connection.</p>
                </div>
              )
              : news.map((n,i) => <NewsCard key={i} item={n} />)
        )}

        {tab === 'events' && (
          events.length === 0
            ? <div className="text-center py-12 text-[#4B5563] text-sm">No events yet</div>
            : events.map(e => <EventCard key={e.id} event={e} registered={registered.has(e.id)} onRegister={handleRegister} />)
        )}
      </div>
    </div>
  );
}
