import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

type DiscoverTab = 'discover' | 'following' | 'news' | 'announcements' | 'events';

interface Post { id:string; user_id:string; username:string; content:string; likes:number; comments_count:number; created_at:string; tags?:string[]; is_announcement:boolean; }
interface NewsItem { title:string; url:string; source:string; published_on:number; imageurl:string; body:string; }
interface Event { id:string; title:string; description:string; reward:string; starts_at:string; ends_at:string; participants_count:number; max_participants:number|null; status:string; }

const TABS = [
  { id:'discover' as DiscoverTab,      label:'Discover'     },
  { id:'following' as DiscoverTab,     label:'Following'    },
  { id:'news' as DiscoverTab,          label:'News'         },
  { id:'announcements' as DiscoverTab, label:'Announcements'},
  { id:'events' as DiscoverTab,        label:'Events'       },
];

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function PostCard({ post, liked, onLike, onFollow, following }: {
  post:Post; liked:boolean;
  onLike:(id:string)=>void; onFollow:(uid:string)=>void; following:string[];
}) {
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
            <p className="text-sm font-bold text-[#F4F6FA]">{post.username ?? 'Trader'}</p>
            <p className="text-[10px] text-[#4B5563]">{timeAgo(post.created_at)}</p>
          </div>
        </div>
        {user && user.id !== post.user_id && (
          <button onClick={() => onFollow(post.user_id)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all flex-shrink-0 ${isFollowing?'border-white/[0.08] text-[#4B5563]':'border-[#2BFFF1]/30 text-[#2BFFF1] hover:bg-[#2BFFF1]/10'}`}>
            {isFollowing ? 'Following' : '+ Follow'}
          </button>
        )}
      </div>
      <p className="text-sm text-[#A7B0B7] leading-relaxed mb-3">{post.content}</p>
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {post.tags.map(t => <span key={t} className="text-[10px] text-[#2BFFF1] bg-[#2BFFF1]/10 px-2 py-0.5 rounded-full">#{t}</span>)}
        </div>
      )}
      <div className="flex items-center gap-4">
        <button onClick={() => onLike(post.id)}
          className={`flex items-center gap-1.5 text-[11px] font-semibold transition-all ${liked?'text-[#F472B6]':'text-[#4B5563] hover:text-[#F472B6]'}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={liked?'currentColor':'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          {post.likes ?? 0}
        </button>
        <span className="flex items-center gap-1.5 text-[11px] text-[#4B5563]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          {post.comments_count ?? 0}
        </span>
      </div>
    </div>
  );
}

export function DiscoverPage({ initialTab }: { initialTab?: string }) {
  const { user, account } = useAuth();
  const [tab,        setTab]        = useState<DiscoverTab>((initialTab as DiscoverTab) ?? 'discover');
  const [posts,      setPosts]      = useState<Post[]>([]);
  const [news,       setNews]       = useState<NewsItem[]>([]);
  const [events,     setEvents]     = useState<Event[]>([]);
  const [liked,      setLiked]      = useState<Set<string>>(new Set());
  const [following,  setFollowing]  = useState<string[]>([]);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [newPost,    setNewPost]    = useState('');
  const [posting,    setPosting]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [newsLoading,setNewsLoad]   = useState(true);
  const [postErr,    setPostErr]    = useState('');

  // ── Load following list ──────────────────────────────────────────────
  const loadFollowing = useCallback(async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('community_follows').select('following_id').eq('follower_id', user.id);
    setFollowing((data ?? []).map((r:any) => r.following_id));
  }, [user?.id]);

  // ── Load liked posts ─────────────────────────────────────────────────
  const loadLiked = useCallback(async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('community_likes').select('post_id').eq('user_id', user.id);
    setLiked(new Set((data ?? []).map((r:any) => r.post_id)));
  }, [user?.id]);

  // ── Load posts ───────────────────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      let q = supabase.from('community_posts').select('*').order('created_at', { ascending:false }).limit(50);
      if (tab === 'following' && user && following.length > 0) q = q.in('user_id', following);
      if (tab === 'following' && (!user || following.length === 0)) { setPosts([]); setLoading(false); return; }
      if (tab === 'announcements') q = q.eq('is_announcement', true);
      const { data, error } = await q;
      if (error) console.error('loadPosts error:', error.message);
      setPosts((data ?? []) as Post[]);
    } catch(e) { console.error('loadPosts exception:', e); setPosts([]); }
    setLoading(false);
  }, [tab, user?.id, following]);

  // ── Load news ────────────────────────────────────────────────────────
  const loadNews = useCallback(async () => {
    setNewsLoad(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/crypto-news`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (r.ok) { const d = await r.json(); setNews(d.news ?? d ?? []); }
    } catch { setNews([]); }
    setNewsLoad(false);
  }, []);

  // ── Load events ──────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('events').select('*').order('starts_at', { ascending:true });
    setEvents((data ?? []) as Event[]);
    if (user) {
      const { data: regs } = await supabase.from('event_registrations').select('event_id').eq('user_id', user.id);
      setRegistered(new Set((regs ?? []).map((r:any) => r.event_id)));
    }
  }, [user?.id]);

  useEffect(() => { loadFollowing(); loadLiked(); }, [user?.id]);
  useEffect(() => { if(tab==='news') loadNews(); else if(tab==='events') loadEvents(); else loadPosts(); }, [tab, following]);

  // ── Submit post ──────────────────────────────────────────────────────
  const submitPost = async () => {
    if (!supabase || !user || !newPost.trim()) return;
    setPosting(true); setPostErr('');
    const content = newPost.trim().slice(0, 280);
    const tags = Array.from(content.matchAll(/#(\w+)/g)).map(m => m[1].toLowerCase());
    const { error } = await supabase.from('community_posts').insert({
      user_id:    user.id,
      username:   account?.username ?? user.email?.split('@')[0] ?? 'Trader',
      content,
      tags,
      likes:         0,
      comments_count:0,
      is_announcement: false,
    });
    if (error) {
      setPostErr(`Failed to post: ${error.message}`);
      console.error('submitPost error:', error);
    } else {
      setNewPost(''); await loadPosts();
    }
    setPosting(false);
  };

  // ── Like ─────────────────────────────────────────────────────────────
  const handleLike = async (postId: string) => {
    if (!supabase || !user) return;
    if (liked.has(postId)) {
      await supabase.from('community_likes').delete().eq('user_id', user.id).eq('post_id', postId);
      await supabase.from('community_posts').update({ likes: Math.max(0, (posts.find(p=>p.id===postId)?.likes??1)-1) }).eq('id', postId);
      setLiked(prev => { const s=new Set(prev); s.delete(postId); return s; });
      setPosts(prev => prev.map(p => p.id===postId ? {...p, likes:Math.max(0,p.likes-1)} : p));
    } else {
      const { error } = await supabase.from('community_likes').insert({ user_id:user.id, post_id:postId });
      if (!error) {
        await supabase.from('community_posts').update({ likes:(posts.find(p=>p.id===postId)?.likes??0)+1 }).eq('id', postId);
        setLiked(prev => new Set([...prev, postId]));
        setPosts(prev => prev.map(p => p.id===postId ? {...p, likes:p.likes+1} : p));
      }
    }
  };

  // ── Follow ───────────────────────────────────────────────────────────
  const handleFollow = async (followingId: string) => {
    if (!supabase || !user) return;
    if (following.includes(followingId)) {
      await supabase.from('community_follows').delete().eq('follower_id', user.id).eq('following_id', followingId);
      setFollowing(prev => prev.filter(id => id !== followingId));
    } else {
      const { error } = await supabase.from('community_follows').insert({ follower_id:user.id, following_id:followingId });
      if (!error) setFollowing(prev => [...prev, followingId]);
      else console.error('follow error:', error);
    }
  };

  // ── Register for event ────────────────────────────────────────────────
  const handleRegister = async (eventId: string) => {
    if (!supabase || !user) return;
    const { error } = await supabase.from('event_registrations').insert({ user_id:user.id, event_id:eventId });
    if (!error) {
      setRegistered(prev => new Set([...prev, eventId]));
      setEvents(prev => prev.map(e => e.id===eventId ? {...e, participants_count:e.participants_count+1} : e));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 pt-4 overflow-x-auto flex-shrink-0 pb-3 border-b border-white/[0.06]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab===t.id?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-24 md:pb-4">

        {/* Post composer */}
        {tab === 'discover' && user && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2BFFF1] to-[#A78BFA] flex items-center justify-center font-bold text-sm text-[#05060B] flex-shrink-0">
                {(account?.username || user.email || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <textarea value={newPost} onChange={e => setNewPost(e.target.value.slice(0,280))}
                  placeholder="Share your trading thoughts… use #hashtags"
                  rows={2}
                  className="w-full bg-transparent text-sm text-[#F4F6FA] placeholder-[#374151] outline-none resize-none"/>
                {postErr && <p className="text-[10px] text-red-400 mt-1">{postErr}</p>}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-[#4B5563]">{newPost.length}/280</span>
                  <button onClick={submitPost} disabled={posting || !newPost.trim()}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Posts / Following */}
        {(tab === 'discover' || tab === 'following' || tab === 'announcements') && (
          loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-[#4B5563]">
              <div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
              <span className="text-xs">Loading posts…</span>
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#4B5563]">
                {tab==='following'?'Follow some traders to see their posts here':'No posts yet — be the first!'}
              </p>
            </div>
          ) : posts.map(p => (
            <PostCard key={p.id} post={p} liked={liked.has(p.id)} onLike={handleLike} onFollow={handleFollow} following={following}/>
          ))
        )}

        {/* News */}
        {tab === 'news' && (
          newsLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-[#4B5563]"><div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs">Loading news…</span></div>
          ) : news.length === 0 ? (
            <p className="text-center text-sm text-[#4B5563] py-12">No news available right now</p>
          ) : news.map((n, i) => (
            <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all">
              <p className="text-sm font-bold text-[#F4F6FA] mb-1 line-clamp-2">{n.title}</p>
              <p className="text-[11px] text-[#6B7280] line-clamp-2 mb-2">{n.body}</p>
              <div className="flex justify-between text-[9px] text-[#374151]">
                <span>{n.source}</span>
                <span>{new Date(n.published_on * 1000).toLocaleDateString()}</span>
              </div>
            </a>
          ))
        )}

        {/* Events */}
        {tab === 'events' && (
          events.length === 0 ? (
            <p className="text-center text-sm text-[#4B5563] py-12">No events right now</p>
          ) : events.map(e => {
            const isActive = e.status === 'active' || (new Date(e.starts_at) <= new Date() && new Date(e.ends_at) >= new Date());
            const isFull = e.max_participants != null && e.participants_count >= e.max_participants;
            const isReg = registered.has(e.id);
            return (
              <div key={e.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isActive?'bg-green-500/20 text-green-400 border border-green-500/30':'bg-[#4B5563]/20 text-[#4B5563]'}`}>{isActive?'LIVE':e.status.toUpperCase()}</span>
                      {isReg && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25">Registered</span>}
                    </div>
                    <p className="font-bold text-[#F4F6FA] text-base">{e.title}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[#F59E0B] font-bold text-sm">{e.reward}</p>
                    <p className="text-[10px] text-[#4B5563]">Reward</p>
                  </div>
                </div>
                <p className="text-sm text-[#A7B0B7] mb-4 leading-relaxed">{e.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#6B7280]">{e.participants_count}{e.max_participants?`/${e.max_participants}`:''} joined · Ends {new Date(e.ends_at).toLocaleDateString()}</span>
                  {user && isActive && !isReg && !isFull && (
                    <button onClick={() => handleRegister(e.id)} className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Join Now</button>
                  )}
                  {isFull && !isReg && <span className="text-xs text-[#4B5563]">Full</span>}
                  {!user && <span className="text-xs text-[#4B5563]">Sign in to join</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
