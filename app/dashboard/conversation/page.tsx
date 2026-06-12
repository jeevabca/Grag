"use client";

import { Flex, Typography, Button, Input, Tooltip, Avatar, Drawer, Grid, Upload, message } from "antd";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { LuBot, LuHistory, LuSearch, LuPlus, LuPaperclip, LuFileText,} from "react-icons/lu";
import {
  FiUser,
  FiSend,
  FiMoreVertical,
  FiTrash2,
  FiX,
  FiCopy,
  FiEdit2,
} from "react-icons/fi";
import { MdBarChart as MdBarChartIcon } from "react-icons/md";
import { PiGraphLight } from "react-icons/pi";
import { getCookie } from "../../config/cookies";
import { AUTH_COOKIE_KEY, API_BASE_URL } from "../../config/config";
import AgentList from "../../components/ui/AgentList";
import useAxios from "../../hooks/useAxios";
import { useStore } from "../../hooks/useStore";
import type { Agent } from "../../components/ui/type";
import type { UploadFile } from "antd";
import { Switch } from "antd";

const { Text, Title } = Typography;

// ─── Types ───────────────────────────────────────────────────────────────────
type MessageSource = {
  fileName: string;
  positions: number[];
};
type Message = {
  role: "user" | "assistant";
  content: string;
  confidence?: number;
  nodes?: number;
  timestamp?: string;
  message_count?: number;
  sources?: MessageSource[];
  file?: {
    name: string;
    type: string;
    url: string;
  };
};

type ChatSession = {
  id: string;
  agentId: string;
  agentName: string;
  messages: Message[];
  updatedAt: number;
  agent_id: string;
  title: string;
  message_count: number;
  is_active: boolean;
  last_message_at: string;
  created_at: string;
};

type Agents = { id: string; name: string } | null;

// ─── API Helpers ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getCookie(AUTH_COOKIE_KEY)}`,
  };
}

async function fetchSessions(agent: Agents): Promise<ChatSession[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/chats/${agent?.id}/sessions?limit=20&offset=0`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const result = await res.json();
    return result.data ?? [];
  } catch (e) {
    console.error("fetchSessions failed:", e);
    return [];
  }
}

type AgentListResponse = {
  data?: {
    agents?: Agent[];
  };
};

export default function ChatPlaygroundPage() {
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any>([]);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const screen = Grid.useBreakpoint();
  const setAgentList = useStore((state) => state.setAgentList);
  const setBotsCache = useStore((state) => state.setBotsCache);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const [getAgents] = useAxios<AgentListResponse>({ endpoint: "GETAGENTLIST", hideErrorMsg: true });
  const bottomRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const streamingTextRef = useRef<string>("");
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);

// ─── IPPO ADD PANNA VENDIYA STATES ───────────────────────────────────
const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
const [tempEditText, setTempEditText] = useState("");
  // File Upload State Tracker
  const [attachedFile, setAttachedFile] = useState<UploadFile | null>(null);

  function mapAgentsToList(agents: Agent[]) {
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.is_active ? "active" : "draft",
    }));
  }

  // ─── Persistence Logic ──────────────────────────────────────────────────────
  useEffect(() => {
    getAgents(undefined, (payload) => {
      const agents = payload?.data?.agents ?? [];
      setBotsCache(agents);
      setAgentList(mapAgentsToList(agents));
    });
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (agent) {
      (async () => {
        const data = await fetchSessions(agent);
        setSessions(data);
      })();
    }
    return () => {
      ws.current?.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [agent]);

  // ─── WebSocket Logic ────────────────────────────────────────────────────────

  const connectWs = useCallback(function connectSocket() {
    if (!agent?.id) return;

    if (ws.current) {
      ws.current.close();
    }

    setWsStatus("connecting");

    const defaultWsHost = API_BASE_URL
      .replace(/^http/, "ws")
      .split("/api/v1")[0];

    const wsHost = process.env.NEXT_PUBLIC_WS_URL || defaultWsHost;
    const wsUrl = `${wsHost}/api/v1/rag/ws/${agent.id}?token=${getCookie(AUTH_COOKIE_KEY)}`;

    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      setWsStatus("open");
      console.log("opend");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };

    socket.onmessage = (event) => {
      const rawData = String(event.data);
      console.log("onmessage");
      if (!rawData.startsWith("{") ) { //&& !rawData.startsWith("[")) rawData.length === 1 || (
        streamingTextRef.current += rawData;
        setStreamingText(streamingTextRef.current);
        setIsTyping(true);
        return;
      }

      try {
        const data = JSON.parse(rawData);
        if (data.type === "metadata") return;

        if (data.type === "done") {
          const accumulated = streamingTextRef.current;
          console.log("DELTA:",accumulated)
          let textContent = accumulated.replace(/<think>[\s\S]*?<\/think>/g, "");
          const extractedSources: MessageSource[] = [];

          // const sourceRegex =
          //     /\[Source:\s*(.+?)(?:\s*-\s*Position\s*([^\]]+))?\]/g;
          const sourceRegex =
          /(?:\[Source:\s*(.+?)(?:\s*-\s*Position\s*([^\]]+))?\]|\(Source:\s*(.+?)(?:\s*-\s*Position\s*([^)]+))?\))/g;

            let match;

            while ((match = sourceRegex.exec(accumulated)) !== null) {
              const fileName = match[1]?.trim() || "";

              const positions = match[2]
                ? match[2]
                    .split(",")
                    .map((p) => parseInt(p.trim()))
                    .filter((p) => !isNaN(p))
                : [];

              const exists = extractedSources.some(
              (source) => source.fileName === fileName
            );

            if (!exists) {
              extractedSources.push({
                fileName,
                positions,
              });
            }
            }

          if (extractedSources.length > 0) {
            textContent = accumulated.replace(/\[Source:[^\]]+\]/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          }
          if (accumulated) {
            setMessages((prev: any) => [
              ...prev,
              {
                role: "assistant",
                content: textContent,
                sources: extractedSources.length > 0 ? extractedSources : undefined,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              },
            ]);
          }
          streamingTextRef.current = "";
          setStreamingText("");
          setIsTyping(false);
          return;
        }

        if (data.type === "chunk" || data.type === "delta" || data.type === "content" || data.type === "text") {
          const textChunk = data.message || data.content || data.text || "";
          streamingTextRef.current += textChunk;
          setStreamingText(streamingTextRef.current);
          setIsTyping(true);
          return;
        }
      } catch (err) {
        streamingTextRef.current += rawData;
        setStreamingText(streamingTextRef.current);
        setIsTyping(true);
        console.log(err);
      }
    };

    socket.onclose = () => {
      setWsStatus("closed");
      console.log("conlose");
      reconnectTimeoutRef.current = setTimeout(() => {
        if (agent?.id) {
          connectSocket();
        }
      }, 3000);
    };

    socket.onerror = () => {
      setWsStatus("error");
    };
  }, [agent?.id]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      ws.current?.close();
    };
  }, [connectWs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const startNewChat = (selectedAgent: { id: string; name: string }) => {
    const newSessionId = `session_${Date.now()}`;
    const newSession: any = {
      id: newSessionId,
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      messages: [],
      updatedAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setAgent(selectedAgent);
  };

  const loadSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    
    const mappedMessages = (session.messages || []).map((msg: any) => ({
      role: msg.role,
      content: msg.content,
      file: msg.file, 
      timestamp: msg.created_at 
        ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));

    setMessages(mappedMessages);
    setAgent({ 
      id: session.agent_id || session.agentId, 
      name: session.title || session.agentName 
    });
    setHistoryDrawerOpen(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
      setMessages([]);
      setAgent(null);
    }
  };

  // Process files dynamically before upload triggers
  const handleBeforeUpload = (file: UploadFile) => {
    const isValidSize = (file.size ?? 0) / 1024 / 1024 < 25; // 25MB limit
    if (!isValidSize) {
      message.error("File details exceed security isolation thresholds (25MB max).");
      return Upload.LIST_IGNORE;
    }
    
    // Formulate dynamic object properties for UI preview rendering
    file.url = URL.createObjectURL(file as any);
    setAttachedFile(file);
    return false; // Stop auto post action upload handling
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if ((!trimmed && !attachedFile) || !agent?.id || wsStatus !== "open") return;

    if (!currentSessionId) {
      const newId = `session_${Date.now()}`;
      const newSession: any = {
        id: newId,
        agentId: agent.id,
        agentName: agent.name,
        messages: [],
        updatedAt: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newId);
    }

    // Build payload structure containing optional file metrics
    let payloadFile = undefined;
    if (attachedFile) {
      payloadFile = {
        name: attachedFile.name,
        type: attachedFile.type || "",
        url: attachedFile.url || "",
      };
    }

    setMessages((prev: any) => [...prev, { 
      role: "user", 
      content: trimmed,
      file: payloadFile,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    }]);
    
    // Dispatch structural data to active micro-orchestration node
    ws.current?.send(JSON.stringify({ 
      query: trimmed,
      file: payloadFile ? { name: payloadFile.name, type: payloadFile.type } : null 
    }));

    setInput("");
    setAttachedFile(null); // Clear dock frame tracking parameters
    streamingTextRef.current = "";
    setStreamingText("");
    setIsTyping(true);
  };

  const handleCopyMessage = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    message.success("Copied");
  } catch {
    message.error("Copy failed");
  }
};
const handleEditMessage = (index: number, content: string) => {
  setEditingMessageIndex(index);
  setTempEditText(content);
};

const handleSaveEdit = (index: number) => {
  if (!tempEditText.trim() || !agent?.id || wsStatus !== "open") return;

  // 1. Logic Fix: Edited message-oda cut panni, pazhaya bot responses-ai remove panniduvom
  const updatedMessages = messages.slice(0, index + 1);
  
  // 2. Ippo edit panna message-ai mattrum update pannuvom
  updatedMessages[index].content = tempEditText.trim();
  setMessages(updatedMessages);

  // 3. Edit mode-ai close seiyavum
  setEditingMessageIndex(null);

  // 4. WebSocket-il puthu query-ai anupavum
  ws.current?.send(JSON.stringify({ 
    query: tempEditText.trim(),
    file: null 
  }));

  setIsTyping(true);
};

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend();
  };

  return (
    <div className="h-[calc(100vh-60px)] md:h-[calc(100vh-100px)] w-full flex items-center justify-center p-0 md:p-8 bg-[var(--app-bg-deep)]/20 antialiased selection:bg-[#285d91]/20">
      
      <Flex vertical className="w-full h-full bg-gradient-to-b from-[var(--app-surface)] via-[var(--app-surface)]/95 to-[var(--app-surface)] rounded-none md:rounded-[28px] border-0 md:border border-[var(--app-border)]/60 shadow-2xl overflow-hidden relative">
        
        {/* Top Header */}
        <div className="w-full px-4 md:px-8 py-4 border-b border-[var(--app-border)]/40 backdrop-blur-md bg-[var(--app-surface)]/50 sticky top-0 z-40 transition-all">
          <Flex justify="space-between" align="center" className="gap-2">
            
           {screen.md && <Flex align="center" gap={12} className="min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#285d91] to-[#3a7cb3] text-white flex items-center justify-center shadow-md shadow-blue-900/10 shrink-0">
                <LuBot size={20} className="animate-pulse" />
              </div>
              <Flex vertical className="min-w-0">
                <Title level={5} className="!m-0 !text-[var(--app-text)] !font-extrabold tracking-tight truncate text-sm md:text-base">
                  {agent?.name || "Neural Cortex"}
                </Title>
                <Flex align="center" gap={5} className="mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === "open" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                  <Text className="text-[9px] font-bold uppercase tracking-widest text-[var(--app-text-soft)] opacity-80 truncate">
                    {wsStatus === "open" ? "Link Stabilized" : "Syncing Link Core..."}
                  </Text>
                  <Switch
                  checked={isEnabled}
                  onChange={(checked) => {
                    setIsEnabled(checked);
                    console.log(checked); // true or false
                  }}
                />
                </Flex>
              </Flex>
            </Flex>}
            
            <Flex align="center" gap={8} className="shrink-0">
              <div className="scale-90 md:scale-100 origin-right">
                <AgentList
                  selectedId={agent?.id}
                  onChange={(id: string, name: string) => {
                    const existing = sessions.find(s => s.agentId === id);
                    if (existing) loadSession(existing);
                    else startNewChat({ id, name });
                  }}
                />
              </div>
              <Button 
                type="text" 
                icon={<FiMoreVertical className="text-lg text-[var(--app-text-soft)]" />} 
                onClick={() => setHistoryDrawerOpen(true)}
                className="hover:bg-[var(--app-hover)] !rounded-xl w-10 h-10 flex items-center justify-center transition-colors"
              />
            </Flex>
          </Flex>
        </div>

        {/* Conversation Stream */}
        <div className="flex-1 overflow-y-auto px-4 md:px-12 py-6 md:py-10 space-y-6 custom-scrollbar bg-dots-pattern">
          {messages.length === 0 && !isTyping && (
            <Flex vertical align="center" justify="center" className="h-full space-y-5 opacity-80 select-none">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-b from-[var(--app-surface-muted)] to-[var(--app-border)]/20 flex items-center justify-center relative shadow-inner">
                <div className="absolute inset-0 bg-[#285d91]/5 rounded-2xl blur-xl" />
                <LuBot size={32} className="text-[#285d91]/60" />
              </div>
              <div className="text-center max-w-sm px-4">
                <h3 className="m-0 text-[var(--app-text)] font-black text-lg md:text-xl tracking-tight">Initiate Thought Sequence</h3>
                <Text className="text-[var(--app-text-muted)] text-xs font-medium mt-1 block">
                  Select a workflow node structure above or query directly to execute runtime analysis loop frames.
                </Text>
              </div>
            </Flex>
          )}

          {messages.map((msg: any, i: any) => {
            const isUser = msg.role === "user";
            const hasImage = msg.file?.type?.startsWith("image/");
            const hasDoc = msg.file && !hasImage;

            return (
              <div key={i} className={`flex w-full ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div className={`flex gap-3 max-w-[88%] md:max-w-[75%] ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                  
                  <Avatar 
                    size={32}
                    icon={isUser ? <FiUser /> : <LuBot />} 
                    className={`${isUser ? "bg-emerald-500/10 !text-emerald-600" : "bg-[#285d91]/10 !text-[#285d91]"} shadow-none shrink-0 border border-current/10 font-bold`}
                  />

                  <div className="flex flex-col space-y-1">
                    <span className={`text-[9px] font-bold text-[var(--app-text-soft)] px-1 ${isUser ? "text-right" : "text-left"}`}>
                      {msg.timestamp}
                    </span>

                    {/* <div className={`p-4 md:p-5 rounded-2xl transition-all duration-200 shadow-sm border ${ */}
                    <div
                          className={`group relative p-4 md:p-5 rounded-2xl transition-all duration-200 shadow-sm border ${
                      isUser 
                        ? "bg-[#285d91] text-white rounded-tr-none border-[#285d91]/20 font-medium" 
                        : "bg-[var(--app-surface-muted)] text-[var(--app-text)] rounded-tl-none border-[var(--app-border)]/40 font-normal"
                    }`}>
                      
                      {/* Dynamic File Rendering UI Framework */}
                      <div className="absolute -bottom-10 right-0 opacity-0 group-hover:opacity-100 transition-all duration-200 flex gap-2 z-20">
                          <button
                            onClick={() => handleCopyMessage(msg.content)}
                            className="bg-neutral-800 text-white p-2 rounded-lg hover:bg-neutral-700 cursor-pointer"
                          >
                            <FiCopy size={14} />
                          </button>

                          {isUser && (
                          <button
                            onClick={() => handleEditMessage(i, msg.content)} // <-- Ingu 'i' add seiyapattuள்ளது
                            className="bg-neutral-800 text-white p-2 rounded-lg hover:bg-neutral-700 cursor-pointer"
                          >
                            <FiEdit2 size={14} />
                          </button>
                        )}
                        </div>
                      {hasImage && (
                        <div className="mb-3 overflow-hidden rounded-xl max-w-[280px] border border-white/10 shadow-sm">
                          <img src={msg.file.url} alt={msg.file.name} className="w-full h-auto object-cover max-h-52 dynamic-img-render" />
                        </div>
                      )}

                      {hasDoc && (
                        <Flex align="center" gap={10} className={`mb-3 p-3 rounded-xl border ${isUser ? "bg-black/10 border-white/10" : "bg-[var(--app-surface)] border-[var(--app-border)]/60"} max-w-[280px]`}>
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isUser ? "bg-white/10 text-white" : "bg-[#285d91]/10 text-[#285d91]"}`}>
                            <LuFileText size={18} />
                          </div>
                          <Flex vertical className="min-w-0 flex-1">
                            <Text className={`text-xs font-bold truncate ${isUser ? "!text-white" : "!text-[var(--app-text)]"}`}>
                              {msg.file.name}
                            </Text>
                            <Text className={`text-[9px] uppercase tracking-wider font-extrabold opacity-60 ${isUser ? "!text-white/80" : "!text-[var(--app-text-soft)]"}`}>
                              Document Log
                            </Text>
                          </Flex>
                        </Flex>
                      )}

                      {/* {msg.content && <p className="text-xs md:text-sm leading-relaxed whitespace-pre-wrap m-0 font-medium">{msg.content}</p>} */}
                    
                      {/* {!isUser && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-[var(--app-border)]/30 w-full animate-in fade-in duration-200">
                          <div className="flex flex-wrap items-center gap-2">
                            
                            <div className="inline-flex items-center gap-2 p-1.5 px-3 bg-[var(--app-surface-muted)] border border-[var(--app-border)]/60 rounded-full max-w-[220px] shadow-sm">
                              <LuFileText size={13} className="text-[#285d91] shrink-0" />
                              <Text className="text-xs font-bold truncate text-[var(--app-text)]">
                                {msg.sources[0].fileName}
                              </Text>
                              <span className="text-[9px] font-extrabold text-[var(--app-text-muted)] opacity-60 bg-[var(--app-surface)] px-1.5 py-0.5 rounded-md shrink-0">
                                Pos: {msg.sources[0].positions?.join(", ")}
                              </span>
                            </div>

                            {msg.sources.length > 1 && (
                              <Tooltip
                                title={
                                  <div className="flex flex-col gap-1 p-1">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-300 block mb-1">Additional Sources:</span>
                                    {msg.sources.slice(1).map((src: any, idx: number) => (
                                      <div key={idx} className="text-xs border-b border-white/10 pb-1 last:border-0">
                                        • {src.fileName} <span className="text-[10px] opacity-70">(Pos: {src.positions?.join(", ")})</span>
                                      </div>
                                    ))}
                                  </div>
                                }
                                placement="top"
                              >
                                <div className="inline-flex items-center justify-center px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-xs rounded-full cursor-pointer transition-colors border border-neutral-700/50 shadow-sm select-none">
                                  +{msg.sources.length - 1}
                                </div>
                              </Tooltip>
                            )}
                            
                          </div>
                        </div>
                      )} */}
                      {msg.content &&                  
                      <div className="text-xs md:text-sm leading-relaxed text-[var(--app-text)] font-medium">
                        
                        {/* Inline Editing Mode checking */}
                        {editingMessageIndex === i ? (
                        <div className="flex flex-col gap-3 my-2 w-full animate-in fade-in zoom-in-95 duration-200">
                          <div className="relative group">
                            <Input.TextArea
                              value={tempEditText}
                              onChange={(e) => setTempEditText(e.target.value)}
                              autoSize={{ minRows: 2, maxRows: 6 }}
                              className="!bg-[#1e293b] !text-white !border-blue-500/50 focus:!border-blue-400 !shadow-lg rounded-xl p-3 placeholder-white/20 transition-all"
                              placeholder="Edit your query..."
                            />
                            <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                          </div>
                          
                          <div className="flex gap-2 justify-end">
                            <Button 
                              type="text" 
                              className="!text-white/60 hover:!text-white hover:!bg-white/5 !px-4 !h-8 rounded-lg font-medium transition-all"
                              onClick={() => setEditingMessageIndex(null)}
                            >
                              Cancel
                            </Button>
                            <Button 
                              type="primary" 
                              className="!bg-blue-600 hover:!bg-blue-500 !border-0 !px-6 !h-8 rounded-lg font-bold shadow-lg shadow-blue-900/20 transition-all"
                              onClick={() => handleSaveEdit(i)}
                            >
                              Save & Send
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // Normal Display Mode
                        <span className="whitespace-pre-wrap mr-2 leading-7">{msg.content}</span>
                      )}

                        {!isUser && msg.sources && msg.sources.length > 0 && isEnabled && (
                          <div className="flex justify-end">
                          <span className="inline-flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2.5 py-0.5 rounded-full border border-neutral-700/50 shadow-sm transition-colors align-middle select-none cursor-pointer">
                            <LuFileText size={11} className="text-[#3a7cb3]" />
                            <span className="text-[11px] font-bold tracking-tight">
                              {/* {msg.sources[0].fileName} */}
                              {msg.sources[0].fileName.startsWith("http") ? (
                                      <a
                                        href={msg.sources[0].fileName}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] font-bold tracking-tight text-blue-400 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {msg.sources[0].fileName}
                                      </a>
                                    ) : (
                                      <span className="text-[11px] font-bold tracking-tight">
                                        {msg.sources[0].fileName}
                                      </span>
                                    )}
                            </span>

                            {msg.sources.length > 1 && (
                              <Tooltip
                                title={
                                  <div className="flex flex-col gap-1 p-1">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-300 block mb-1">Additional Sources:</span>
                                    {/* {msg.sources.slice(1).map((src: any, idx: number) => (
                                      <div key={idx} className="text-xs border-b border-white/10 pb-1 last:border-0">
                                        • {src.fileName}
                                      </div>
                                    ))} */}
                                    {msg.sources.slice(1).map((src: any, idx: number) => (
                                              <div
                                                key={idx}
                                                className="text-xs border-b border-white/10 pb-1 last:border-0"
                                              >
                                                {src.fileName.startsWith("http") ? (
                                                  <a
                                                    href={src.fileName}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-400 hover:underline"
                                                  >
                                                    {src.fileName}
                                                  </a>
                                                ) : (
                                                  src.fileName
                                                )}
                                              </div>
                                            ))}
                                  </div>
                                }
                                placement="top"
                              >
                                <span className="text-[10px] font-black text-neutral-400 pl-0.5">
                                  +{msg.sources.length - 1}
                                </span>
                              </Tooltip>
                            )}
                          </span>
                          </div>
                        )}

                      </div>}


                      {!isUser && (msg.confidence || msg.nodes) && (
                        <div className="mt-4 pt-3 border-t border-[var(--app-border)]/60 flex flex-wrap gap-2">
                          {msg.confidence && (
                            <span className="flex items-center gap-1.5 text-[9px] font-extrabold text-emerald-600 uppercase tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded-md">
                              <MdBarChartIcon className="text-xs" /> {msg.confidence}% Confidence
                            </span>
                          )}
                          {msg.nodes && (
                            <span className="flex items-center gap-1.5 text-[9px] font-extrabold text-blue-600 uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded-md">
                              <PiGraphLight className="text-xs" /> {msg.nodes} Paths
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            );
          })} 

          {isTyping && (
            <div className="flex w-full justify-start animate-in fade-in duration-300">
              <div className="flex gap-3 max-w-[80%] items-start">
                <Avatar size={32} icon={<LuBot />} className="bg-[#285d91]/10 !text-[#285d91] shrink-0 border border-[#285d91]/10" />
                <div className="flex flex-col space-y-1">
                  <span className="text-[9px] font-bold text-[var(--app-text-soft)] italic px-1">Processing...</span>
                  <div className="p-4 bg-[var(--app-surface-muted)]/60 border border-[var(--app-border)]/40 text-[var(--app-text)] rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--app-text-soft)] font-medium">
                        {streamingText || "Assembling pipeline graphs..."}
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#285d91] animate-ping" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Floating Input Dock Footer */}
        <div className="px-4 md:px-12 pb-6 pt-2 bg-gradient-to-t from-[var(--app-surface)] via-[var(--app-surface)] to-transparent border-t-0 z-30">
          <div className="bg-[var(--app-surface-muted)] border border-[var(--app-border)]/80 rounded-2xl p-2 shadow-lg transition-all focus-within:border-[#285d91]/50 focus-within:ring-4 focus-within:ring-[#285d91]/5 flex flex-col gap-2">
            
            {/* Real-time Dynamic Upload Preview Attachment Frame */}
            {attachedFile && (
              <div className="px-3 pt-2 pb-1 animate-in fade-in duration-200">
                <div className="inline-flex align-center gap-3 bg-[var(--app-surface)] border border-[var(--app-border)]/80 p-2.5 rounded-xl relative group shadow-sm max-w-xs">
                  {attachedFile.type?.startsWith("image/") ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/5 shrink-0 border border-[var(--app-border)]/40">
                      <img src={attachedFile.url} alt="preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#285d91]/10 text-[#285d91] flex items-center justify-center shrink-0">
                      <LuFileText size={20} />
                    </div>
                  )}
                  <Flex vertical className="min-w-0 pr-6 justify-center">
                    <Text className="text-xs font-bold truncate text-[var(--app-text)]">{attachedFile.name}</Text>
                    <Text className="text-[9px] font-bold text-[var(--app-text-soft)] uppercase tracking-wider">Ready to upload</Text>
                  </Flex>
                  <button 
                    onClick={() => setAttachedFile(null)} 
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm cursor-pointer"
                  >
                    <FiX size={11} />
                  </button>
                </div>
              </div>
            )}

            <Flex align="center" justify="space-between" className="gap-1">
              
              {/* Media Upload Node Trigger Trigger */}
              <Upload
                beforeUpload={handleBeforeUpload}
                showUploadList={false}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                disabled={!agent || wsStatus !== "open"}
              >
                <Tooltip title="Share media logs" placement="topLeft">
                  <Button
                    type="text"
                    disabled={!agent || wsStatus !== "open"}
                    icon={<LuPaperclip className="text-base text-[var(--app-text-soft)]" />}
                    className="hover:bg-[var(--app-hover)] !rounded-xl w-9 h-9 flex items-center justify-center transition-colors"
                  />
                </Tooltip>
              </Upload>

              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={agent ? `Message ${agent.name}...` : "Choose an operational agent node..."}
                disabled={!agent || wsStatus !== "open"}
                bordered={false}
                className="w-full !py-2.5 !px-2 !bg-transparent !font-semibold !text-xs md:!text-sm !text-[var(--app-text)] !placeholder:text-[var(--app-text-soft)]/70 focus:outline-none"
              />
              
              <Tooltip title="Press Enter to send" placement="topRight">
                <button
                  onClick={handleSend}
                  disabled={!agent || (!input.trim() && !attachedFile) || wsStatus !== "open"}
                  className="w-9 h-9 bg-[#285d91] text-white rounded-xl flex items-center justify-center hover:bg-[#1e4873] active:scale-95 disabled:opacity-20 disabled:hover:scale-100 disabled:bg-[var(--app-text-soft)]/20 transition-all shrink-0 shadow-md shadow-blue-900/10"
                >
                  <FiSend size={15} />
                </button>
              </Tooltip>
            </Flex>
          </div>
        </div> 
      </Flex>

      {/* Drawer Thread History Component */}
      <Drawer
        title={
          <Flex align="center" justify="space-between" className="w-full">
            <Title level={5} className="!m-0 !text-[#285d91] !font-black uppercase tracking-wider text-[11px]">Thread Terminal</Title>
            <Button 
              type="text" 
              icon={<LuPlus />} 
              onClick={() => { setAgent(null); setCurrentSessionId(null); setMessages([]); setHistoryDrawerOpen(false); }} 
              className="text-[#285d91] hover:bg-[var(--app-active-bg)] !rounded-xl w-8 h-8 flex items-center justify-center"
            />
          </Flex>
        }
        placement="right"
        onClose={() => setHistoryDrawerOpen(false)}
        open={historyDrawerOpen}
        width={340}
        closeIcon={null}
        styles={{
          body: { padding: '16px', background: 'var(--app-surface)' },
          header: { borderBottom: '1px solid var(--app-border)/40', padding: '18px 16px' }
        }}
      >
        <div className="space-y-4 h-full flex flex-col">
          <Input 
            prefix={<LuSearch className="text-[var(--app-text-soft)]" />}
            placeholder="Search operational logs..."
            className="!rounded-xl !bg-[var(--app-surface-muted)] !border-none !h-9 font-semibold text-xs text-[var(--app-text)] placeholder:text-[var(--app-text-soft)]"
          />

          <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
            {sessions.length > 0 ? (
              sessions.map((s) => {
                const isActiveSession = currentSessionId === s.id; 
                return (
                  <div 
                    key={s.id} 
                    onClick={() => loadSession(s)}
                    className={`group relative p-3.5 rounded-xl cursor-pointer transition-all border ${
                      isActiveSession 
                        ? "bg-[#285d91] text-white shadow-md border-transparent" 
                        : "bg-[var(--app-surface-muted)] hover:bg-[var(--app-hover)] text-[var(--app-text)] border-[var(--app-border)]/40"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <Text className={`font-bold text-xs block truncate flex-1 ${isActiveSession ? "text-white font-extrabold" : "text-[var(--app-text)]"}`}>
                        {s.title}
                      </Text>
                      <FiTrash2 
                        onClick={(e) => deleteSession(e, s.id)}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0 ${isActiveSession ? "text-white/60 hover:text-white" : "text-[var(--app-text-soft)] hover:text-red-500"}`} 
                      />
                    </div>
                    <div className="flex justify-between items-center mt-3">
                      <span className={`text-[10px] font-semibold opacity-60 ${isActiveSession ? "text-white/80" : "text-[var(--app-text-muted)]"}`}>
                        {new Date(s.created_at).toLocaleDateString()}
                      </span>
                      <div className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-widest ${
                        isActiveSession ? "bg-white/20 text-white" : "bg-[var(--app-active-bg)] text-[var(--app-text-soft)]"
                      }`}>
                        {s.message_count} frames
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <Flex vertical align="center" justify="center" className="h-full py-10 opacity-30 text-center">
                <LuHistory size={24} className="text-[#285d91] mb-2" />
                <Text className="font-bold text-[9px] uppercase tracking-widest text-[var(--app-text-muted)]">No active threads</Text>
              </Flex>
            )}
          </div>
        </div>
      </Drawer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--app-border);
          border-radius: 10px;
        }
        .bg-dots-pattern {
          background-image: radial-gradient(var(--app-border) 1px, transparent 1px);
          background-size: 24px 24px;
          background-repeat: repeat;
        }
        .dynamic-img-render {
          transition: transform 0.2s ease-in-out;
        }
        .dynamic-img-render:hover {
          transform: scale(1.02);
        }
      `}</style>
    </div>
  );
}


























// "use client";

// import { Flex, Typography, Badge, Button, Input, Tooltip, Avatar } from "antd";
// import React, { useState, useRef, useEffect, useCallback } from "react";
// import { LuBot, LuHistory, LuSearch, LuPlus } from "react-icons/lu";
// import { FiUser, FiSend, FiMoreVertical, FiTrash2 } from "react-icons/fi";
// import { MdBarChart } from "react-icons/md";
// import { PiGraphLight } from "react-icons/pi";
// import { getCookie } from "../../config/cookies";
// import { AUTH_COOKIE_KEY, API_BASE_URL } from "../../config/config";
// import AgentList from "../../components/ui/AgentList";
// import useAxios from "../../hooks/useAxios";
// import { useStore } from "../../hooks/useStore";
// import type { Agent } from "../../components/ui/type";



// const { Text, Title } = Typography;

// // ─── Types ───────────────────────────────────────────────────────────────────

// type Message = {
//   role: "user" | "assistant";
//   content: string;
//   confidence?: number;
//   nodes?: number;
//   timestamp?: string;
//   message_count?:number
// };

// type ChatSession = {
//   id: string;
//   agentId: string;
//   agentName: string;
//   messages: Message[];
//   updatedAt: number;
//   agent_id:string;
//   title:string;
//   message_count:number;
//   is_active: boolean;
//   last_message_at: string;
//   created_at: string;
// };

// type Agents =
//   { id: string; name: string } | null

// // const STORAGE_KEY = "grag_chat_history";
// // ─── API Helpers ──────────────────────────────────────────────────────────────

// function authHeaders() {
//   return {
//     "Content-Type": "application/json",
//     Authorization: `Bearer ${getCookie(AUTH_COOKIE_KEY)}`,
//   };
// }

// // GET /api/v1/chat/sessions  →  ChatSession[]
// // Backend already saves every message via WebSocket — we only read here.
// async function fetchSessions(agent :Agents): Promise<ChatSession[]> {
//   try {
//     const res = await fetch(`${API_BASE_URL}/chats/${agent?.id}/sessions?limit=20&offset=0`, {
//       headers: authHeaders(),
//     });
//     if (!res.ok) throw new Error(`${res.status}`);
//    const result = await res.json();
// return result.data ?? [];
//   } catch (e) {
//     console.error("fetchSessions failed:", e);
//     return [];
//   }
// }

// // DELETE /api/v1/chat/sessions/:id
// // async function deleteSessionAPI(sessionId: string): Promise<void> {
// //   try {
// //     await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}`, {
// //       method: "DELETE",
// //       headers: authHeaders(),
// //     });
// //   } catch (e) {
// //     console.error("deleteSession failed:", e);
// //   }
// // }
// type AgentListResponse = {
//   data?: {
//     agents?: Agent[];
//   };
// };

// export default function ChatPlaygroundPage() {
//   const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
//   const [sessions, setSessions] = useState<ChatSession[]>([]);
//   const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
//   const [messages, setMessages] = useState<any>([]);
//   // const [sessionsLoading, setSessionsLoading] = useState(true);
//   const setAgentList = useStore((state) => state.setAgentList);
//   const setBotsCache = useStore((state) => state.setBotsCache);
//   const [input, setInput] = useState("");
//   const [streamingText, setStreamingText] = useState("");
//   const [isTyping, setIsTyping] = useState(false);
//   const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
//   const [getAgents] = useAxios<AgentListResponse>({ endpoint: "GETAGENTLIST", hideErrorMsg: true });
//   const bottomRef = useRef<HTMLDivElement>(null);
//   const ws = useRef<WebSocket | null>(null);
//   const streamingTextRef = useRef<string>("");
//   const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
//   function mapAgentsToList(agents: Agent[]) {
//       return agents.map((agent) => ({
//         id: agent.id,
//         name: agent.name,
//         status: agent.is_active ? "active" : "draft",
//       }));
//     }
//   // ─── Persistence Logic ──────────────────────────────────────────────────────
//   useEffect(()=>{
//     getAgents(undefined, (payload) => {
//       const agents = payload?.data?.agents ?? [];
//       setBotsCache(agents);
//       setAgentList(mapAgentsToList(agents));
//     });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   },[])
//   useEffect(() => {
//     // const stored = localStorage.getItem(STORAGE_KEY);
//     if(agent)
//     {
//       (async () => {
//         // setSessionsLoading(true);
//         const data = await fetchSessions(agent);
//         setSessions(data);
//         // setSessionsLoading(false);
//       })();

//     }
//     // if (stored) {
//     //   try {
//     //     const parsed = JSON.parse(stored);
//     //     if (Array.isArray(parsed)) setSessions(parsed);
//     //   } catch (e) {
//     //     console.error("Failed to parse chat history", e);
//     //   }
//     // }
//     return () => {
//       ws.current?.close();
//       if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
//     };
//   }, [agent]);

//   // useEffect(() => {
//   //   if (sessions.length > 0) {
//   //     localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
//   //   }
//   // }, [sessions]);

//   // useEffect(() => {
//   //   if (currentSessionId && messages.length > 0) {
//   //     setSessions(prev => prev.map(s => 
//   //       s.id === currentSessionId 
//   //         ? { ...s, messages, updatedAt: Date.now() } 
//   //         : s
//   //     ));
//   //   }
//   // }, [messages, currentSessionId]);

//   // ─── WebSocket Logic ────────────────────────────────────────────────────────

// //   const connectWs = useCallback(() => {
// //     if (!agent?.id) return;

// //     if (ws.current) ws.current.close();
// //     setWsStatus("connecting");
    
// //     // Derive WS URL from API_BASE_URL if not explicitly set
// //     const defaultWsHost = API_BASE_URL.replace(/^http/, "ws").split("/api/v1")[0];
// //     const wsHost = process.env.NEXT_PUBLIC_WS_URL || defaultWsHost || "ws://173.212.222.17";
// //     const wsUrl = `${wsHost}/api/v1/rag/ws/${agent.id}?token=${getCookie(AUTH_COOKIE_KEY)}`;
    
// //     const socket = new WebSocket(wsUrl);
// //     ws.current = socket;

// //     socket.onopen = () => {
// //       setWsStatus("open");
// //       if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
// //     };

// //     socket.onmessage = (event) => {
// //       const rawData = String(event.data);
// //       if (rawData.length === 1 || (!rawData.startsWith("{") && !rawData.startsWith("["))) {
// //         streamingTextRef.current += rawData;
// //         setStreamingText(streamingTextRef.current);
// //         setIsTyping(true);
// //         return;
// //       }

// //       try {
// //         const data = JSON.parse(rawData);
// //         if (data.type === "metadata") return;
// //         if (data.type === "done") {
// //           const accumulated = streamingTextRef.current;
// //           if (accumulated) {
// //             setMessages((prev) => [...prev, { 
// //               role: "assistant", 
// //               content: accumulated, 
// //               timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
// //             }]);
// //           }
// //           streamingTextRef.current = "";
// //           setStreamingText("");
// //           setIsTyping(false);
// //           return;
// //         }
// //         if (data.type === "chunk" || data.type === "delta" || data.type === "content" || data.type === "text") {
// //           const textChunk = data.message || data.content || data.text || "";
// //           streamingTextRef.current += textChunk;
// //           setStreamingText(streamingTextRef.current);
// //           setIsTyping(true);
// //           return;
// //         }
// //       } catch (err) {
// //         streamingTextRef.current += rawData;
// //         setStreamingText(streamingTextRef.current);
// //         setIsTyping(true);
// //         console.log(err)
// //       }
// //     };

// //     socket.onclose = () => {
// //       setWsStatus("closed");
// //       if (agent?.id) {
// //         reconnectTimeoutRef.current = setTimeout(() => connectWs(), 3000);
// //       }
// //     };
// //   }, [agent?.id]
// // );

// // ─── WebSocket Logic ────────────────────────────────────────────────────────

// const connectWs = useCallback(function connectSocket() {
//   if (!agent?.id) return;

//   if (ws.current) {
//     ws.current.close();
//   }

//   setWsStatus("connecting");

//   const defaultWsHost = API_BASE_URL
//     .replace(/^http/, "ws")
//     .split("/api/v1")[0];

//   const wsHost =
//     process.env.NEXT_PUBLIC_WS_URL ||
//     defaultWsHost ||
//     "ws://173.212.222.17";

//   const wsUrl = `${wsHost}/api/v1/rag/ws/${agent.id}?token=${getCookie(
//     AUTH_COOKIE_KEY
//   )}`;

//   const socket = new WebSocket(wsUrl);

//   ws.current = socket;

//   socket.onopen = () => {
//     setWsStatus("open");

//     if (reconnectTimeoutRef.current) {
//       clearTimeout(reconnectTimeoutRef.current);
//     }
//   };

//   socket.onmessage = (event) => {
//     const rawData = String(event.data);

//     if (
//       rawData.length === 1 ||
//       (!rawData.startsWith("{") && !rawData.startsWith("["))
//     ) {
//       streamingTextRef.current += rawData;
//       setStreamingText(streamingTextRef.current);
//       setIsTyping(true);
//       return;
//     }

//     try {
//       const data = JSON.parse(rawData);

//       if (data.type === "metadata") return;

//       if (data.type === "done") {
//         const accumulated = streamingTextRef.current;

//         if (accumulated) {
//           setMessages((prev : any) => [
//             ...prev,
//             {
//               role: "assistant",
//               content: accumulated,
//               timestamp: new Date().toLocaleTimeString([], {
//                 hour: "2-digit",
//                 minute: "2-digit",
//               }),
//             },
//           ]);
//         }

//         streamingTextRef.current = "";
//         setStreamingText("");
//         setIsTyping(false);

//         return;
//       }

//       if (
//         data.type === "chunk" ||
//         data.type === "delta" ||
//         data.type === "content" ||
//         data.type === "text"
//       ) {
//         const textChunk =
//           data.message || data.content || data.text || "";

//         streamingTextRef.current += textChunk;
//         setStreamingText(streamingTextRef.current);
//         setIsTyping(true);

//         return;
//       }
//     } catch (err) {
//       streamingTextRef.current += rawData;
//       setStreamingText(streamingTextRef.current);
//       setIsTyping(true);

//       console.log(err);
//     }
//   };

//   socket.onclose = () => {
//     setWsStatus("closed");

//     reconnectTimeoutRef.current = setTimeout(() => {
//       if (agent?.id) {
//         connectSocket();
//       }
//     }, 3000);
//   };

//   socket.onerror = () => {
//     setWsStatus("error");
//   };
// }, [agent?.id]);

//   useEffect(() => {
//     connectWs();
//     return () => {
//       if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
//       ws.current?.close();
//     };
//   }, [connectWs]);

//   useEffect(() => {
//     bottomRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [messages, streamingText]);

//   // ─── Actions ───────────────────────────────────────────────────────────────

//   const startNewChat = (selectedAgent: { id: string; name: string }) => {
//     const newSessionId = `session_${Date.now()}`;
//     const newSession: any = {
//       id: newSessionId,
//       agentId: selectedAgent.id,
//       agentName: selectedAgent.name,
//       messages: [],
//       updatedAt: Date.now()
//     };
//     setSessions(prev => [newSession, ...prev]);
//     setCurrentSessionId(newSessionId);
//     setMessages([]);
//     setAgent(selectedAgent);
//   };

//   const loadSession = (session: ChatSession) => {
//     setCurrentSessionId(session.id);
//     // setMessages(session.message_count);
//     setMessages(
//     session.messages.map((msg: any) => ({
//       role: msg.role,
//       content: msg.content,
//       timestamp: new Date(msg.created_at).toLocaleTimeString([], {
//         hour: "2-digit",
//         minute: "2-digit",
//       }),
//     }))
//   );
//     setAgent({ id: session.agent_id, name: session.title });
//   };

//   const deleteSession = (e: React.MouseEvent, id: string) => {
//     e.stopPropagation();
//     setSessions(prev => prev.filter(s => s.id !== id));
//     if (currentSessionId === id) {
//       setCurrentSessionId(null);
//       setMessages([]);
//       setAgent(null);
//     }
//   };

//   const handleSend = () => {
//     const trimmed = input.trim();
//     if (!trimmed || !agent?.id || wsStatus !== "open") return;

//     if (!currentSessionId) {
//       const newId = `session_${Date.now()}`;
//       const newSession: any = {
//         id: newId,
//         agentId: agent.id,
//         agentName: agent.name,
//         messages: [],
//         updatedAt: Date.now()
//       };
//       setSessions(prev => [newSession, ...prev]);
//       setCurrentSessionId(newId);
//     }

//     setMessages((prev : any) => [...prev, { 
//       role: "user", 
//       content: trimmed, 
//       timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
//     }]);
    
//     setInput("");
//     streamingTextRef.current = "";
//     setStreamingText("");
//     setIsTyping(true);
//     ws.current?.send(JSON.stringify({ query: trimmed }));
//   };

//   const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
//     if (e.key === "Enter") handleSend();
//   };

//   return (
//     <div className="h-[calc(100vh-140px)] w-full flex gap-8 animate-in fade-in duration-700">
      
//       {/* Left Panel: Real Conversation History */}
//       <div className="hidden xl:flex flex-col w-84 bg-[var(--app-surface)]/40 backdrop-blur-md rounded-[32px] border border-[var(--app-border)] shadow-sm overflow-hidden">
//         <div className="p-6 border-b border-[var(--app-border)] space-y-4">
//           <Flex align="center" justify="space-between">
//             <Title level={5} className="!m-0 !text-[#285d91] !font-black uppercase tracking-widest text-[10px]">Chat History</Title>
//             <Button 
//               type="text" 
//               icon={<LuPlus />} 
//               onClick={() => { setAgent(null); setCurrentSessionId(null); setMessages([]); }} 
//               className="text-[#285d91] hover:bg-[var(--app-active-bg)] rounded-lg"
//             />
//           </Flex>
//           <Input 
//             prefix={<LuSearch className="text-[var(--app-text-soft)]" />}
//             placeholder="Search threads..."
//             className="!rounded-2xl !bg-[var(--app-surface-muted)] !border-none !h-10 font-bold text-xs text-[var(--app-text)] placeholder:text-[var(--app-text-soft)]"
//           />
//         </div>

//         <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
//           {sessions.length > 0 ? (
//             sessions.map((s) => (
//               <div 
//                 key={s.id} 
//                 onClick={() => loadSession(s)}
//                 className={`group relative p-4 rounded-2xl cursor-pointer transition-all border ${
//                   currentSessionId === s.id 
//                     ? "bg-[#285d91] text-white shadow-lg border-transparent" 
//                     : "bg-[var(--app-surface-muted)] hover:bg-[var(--app-hover)] text-[var(--app-text)] border-[var(--app-border)]"
//                 }`}
//               >
//                 <div className="flex justify-between items-start mb-1">
//                   <Text className={`font-black text-xs block truncate pr-6 ${currentSessionId === s.id ? "text-white" : "text-[var(--app-text)]"}`}>
//                     {/* {(s.messages?.length ?? 0) > 0 ? s.messages[0].content : s.agentName} */}
//                     {s.title}
//                   </Text>
//                   <FiTrash2 
//                     onClick={(e) => deleteSession(e, s.id)}
//                     className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs ${currentSessionId === s.id ? "text-white/50 hover:text-white" : "text-[var(--app-text-soft)] hover:text-red-500"}`} 
//                   />
//                 </div>
//                 <div className="flex justify-between items-center mt-2">
//                   <Text className={`text-[10px] block opacity-60 font-bold ${currentSessionId === s.id ? "text-white/70" : "text-[var(--app-text-muted)]"}`}>
//                     {new Date(s.created_at).toLocaleDateString()}
//                   </Text>
//                   <div className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
//                     currentSessionId === s.id ? "bg-white/20 text-white" : "bg-[var(--app-active-bg)] text-[var(--app-text-soft)]"
//                   }`}>
//                     {s.message_count} msgs
//                   </div>
//                 </div>
//               </div>
//             ))
//           ) : (
//             <Flex vertical align="center" justify="center" className="h-full py-10 opacity-30 text-center">
//               <LuHistory size={32} className="text-[#285d91] mb-2" />
//               <Text className="font-bold text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">No local history found</Text>
//             </Flex>
//           )}
//         </div>
//       </div>

//       {/* Main Chat Panel */}
//       <Flex vertical className="flex-1 bg-[var(--app-surface)]/80 backdrop-blur-2xl rounded-[40px] border border-[var(--app-border)] shadow-[0_20px_50px_rgba(40,93,145,0.05)] overflow-hidden">
        
//         {/* Chat Header */}
//         <Flex justify="space-between" align="center" className="px-10 py-8 border-b border-[var(--app-border)] bg-[var(--app-surface)]/30">
//           <Flex align="center" gap={16}>
//             <div className="w-14 h-14 rounded-2xl bg-[#285d91] text-white flex items-center justify-center shadow-lg shadow-blue-900/10">
//               <LuBot size={28} />
//             </div>
//             <Flex vertical>
//               <Title level={3} className="!m-0 !text-[var(--app-text)] !font-black tracking-tighter">
//                 {agent?.name || "Neural Assistant"}
//               </Title>
//               <Flex align="center" gap={6}>
//                 <Badge status={wsStatus === "open" ? "success" : "processing"} />
//                 <Text className={`text-[10px] font-black uppercase tracking-[0.2em] ${wsStatus === "open" ? "text-emerald-500" : "text-amber-500"}`}>
//                   {wsStatus === "open" ? "Synthesizer Online" : "Connecting Neural Link..."}
//                 </Text>
//               </Flex>
//             </Flex>
//           </Flex>
          
//           <Flex align="center" gap={12}>
//             <AgentList
//               selectedId={agent?.id}
//               onChange={(id: string, name: string) => {
//                 const existing = sessions.find(s => s.agentId === id);
//                 if (existing) loadSession(existing);
//                 else startNewChat({ id, name });
//               }}
//             />
//             <Button type="text" icon={<FiMoreVertical className="text-xl text-[var(--app-text-soft)]" />} />
//           </Flex>
//         </Flex>

//         {/* Chat Stream */}
//         <div className="flex-1 overflow-y-auto px-10 py-10 space-y-8 custom-scrollbar">
//           {messages.length === 0 && !isTyping && (
//             <Flex vertical align="center" justify="center" className="h-full space-y-6 opacity-40">
//               <div className="w-24 h-24 rounded-[32px] bg-[var(--app-surface-muted)] flex items-center justify-center relative">
//                 <div className="absolute inset-0 bg-[#285d91] rounded-[32px] blur-2xl opacity-10 animate-pulse" />
//                 <LuBot size={48} className="text-[#285d91] relative z-10" />
//               </div>
//               <div className="text-center">
//                 <Title level={2} className="!m-0 !text-[var(--app-text)] !font-black !text-3xl tracking-tighter">Initiate Thought Loop</Title>
//                 <Text className="text-[var(--app-text-muted)] font-bold mt-2 block">Select your AI architect to begin multi-hop reasoning.</Text>
//               </div>
//             </Flex>
//           )}

//         {messages.map((msg : any, i : any) => (
//             <Flex key={i} justify={msg.role === "user" ? "flex-end" : "flex-start"} className="group animate-in slide-in-from-bottom-4 duration-500">
//               <div className="flex flex-col max-w-[75%] gap-2">
//                 <Flex align="center" gap={8} className={`mb-1 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
//                   <Avatar 
//                     icon={msg.role === "user" ? <FiUser /> : <LuBot />} 
//                     className={`${msg.role === "user" ? "bg-emerald-500" : "bg-[#285d91]"} shadow-sm`}
//                   />
//                   <Text className="text-[10px] font-black uppercase tracking-widest text-[var(--app-text-soft)]">{msg.timestamp}</Text>
//                 </Flex>
                
//                 <div className={`relative p-6 rounded-[32px] shadow-sm transition-all duration-300 ${
//                   msg.role === "user" 
//                   ? "bg-[#285d91] text-white rounded-tr-none hover:shadow-blue-900/10" 
//                   : "bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] rounded-tl-none hover:shadow-slate-200/50"
//                 }`}>
//                   <p className="text-sm md:text-base font-semibold leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  
//                   {msg.role === "assistant" && (msg.confidence || msg.nodes) && (
//                     <div className="mt-6 pt-5 border-t border-[var(--app-border)] flex items-center gap-6">
//                       {msg.confidence && (
//                         <Tooltip title="AI Confidence Score">
//                           <span className="flex items-center gap-2 text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-3 py-1 rounded-full">
//                             <MdBarChart className="text-xs" /> {msg.confidence}%
//                           </span>
//                         </Tooltip>
//                       )}
//                       {msg.nodes && (
//                         <Tooltip title="Knowledge Base Nodes Traversed">
//                           <span className="flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full">
//                             <PiGraphLight className="text-xs" /> {msg.nodes} Nodes
//                           </span>
//                         </Tooltip>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </div>
//             </Flex>
//           ))} 

//           {isTyping && (
//             <Flex justify="flex-start" className="animate-in fade-in duration-700">
//               <div className="flex flex-col gap-2">
//                 <Flex align="center" gap={8} className="mb-1">
//                   <Avatar icon={<LuBot />} className="bg-[#285d91]" />
//                   <Text className="text-[10px] font-black uppercase tracking-widest text-[var(--app-text-soft)] italic">Thinking...</Text>
//                 </Flex>
//                 <div className="p-6 bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] rounded-[32px] rounded-tl-none shadow-sm">
//                   <p className="text-sm font-semibold leading-relaxed opacity-60">
//                     {streamingText || "Synthesizing response from knowledge graph..."}
//                   </p>
//                 </div>
//               </div>
//             </Flex>
//           )}
//           <div ref={bottomRef} />
//         </div>

//         {/* Input Dock */}
//         <div className="px-10 py-10 bg-gradient-to-t from-[var(--app-surface)] to-transparent border-t border-[var(--app-border)]/50">
//           <Flex vertical gap={12}>
//             <div className="relative group/input">
//               <Input
//                 value={input}
//                 onChange={(e) => setInput(e.target.value)}
//                 onKeyDown={handleKeyDown}
//                 placeholder={agent ? `Query ${agent.name}...` : "Synchronize with an architect..."}
//                 disabled={!agent || wsStatus !== "open"}
//                 className="!h-20 !pl-8 !pr-24 !bg-[var(--app-surface)] !border-[var(--app-border)] !rounded-[24px] !font-bold !text-lg !text-[var(--app-text)] !placeholder:text-[var(--app-text-soft)] focus:!ring-4 focus:!ring-[#285d91]/5 focus:!border-[#285d91]/20 !transition-all !shadow-2xl shadow-slate-200/10"
//               />
//               <button
//                 onClick={handleSend}
//                 disabled={!agent || !input.trim() || wsStatus !== "open"}
//                 className="absolute right-4 top-4 w-12 h-12 bg-[#285d91] text-white rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-20 disabled:hover:scale-100 transition-all shadow-xl shadow-blue-900/20"
//               >
//                 <FiSend size={24} />
//               </button>
//             </div>
//             <Flex justify="center" align="center" gap={16} className="mt-2">
//               <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--app-text-soft)] hover:text-[#285d91] transition-colors cursor-pointer">Markdown Supported</span>
//               <div className="w-1 h-1 bg-[var(--app-border)] rounded-full" />
//               <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--app-text-soft)] hover:text-[#285d91] transition-colors cursor-pointer">Knowledge Base Context Active</span>
//             </Flex>
//           </Flex>
//         </div>
//       </Flex>

//       <style jsx global>{`
//         .custom-scrollbar::-webkit-scrollbar {
//           width: 6px;
//         }
//         .custom-scrollbar::-webkit-scrollbar-track {
//           background: transparent;
//         }
//         .custom-scrollbar::-webkit-scrollbar-thumb {
//           background: var(--app-border);
//           border-radius: 20px;
//           border: 2px solid transparent;
//           background-clip: content-box;
//         }
//         .custom-scrollbar::-webkit-scrollbar-thumb:hover {
//           background: var(--app-text-soft);
//           background-clip: content-box;
//         }
//       `}</style>
//     </div>
//   );
// }


// "use client";

// import {
//   Flex,
//   Typography,
//   Badge,
//   Button,
//   Input,
//   Tooltip,
//   Avatar,
// } from "antd";

// import React, {
//   useState,
//   useRef,
//   useEffect,
// } from "react";

// import {
//   LuBot,
//   LuHistory,
//   LuSearch,
//   LuPlus,
// } from "react-icons/lu";

// import {
//   FiUser,
//   FiSend,
//   FiTrash2,
// } from "react-icons/fi";

// import { MdBarChart } from "react-icons/md";
// import { PiGraphLight } from "react-icons/pi";

// import { getCookie } from "../../config/cookies";

// import {
//   AUTH_COOKIE_KEY,
//   API_BASE_URL,
// } from "../../config/config";

// import AgentList from "../../components/ui/AgentList";

// const { Text, Title } = Typography;

// /* ───────────────── TYPES ───────────────── */

// type Message = {
//   role: "user" | "assistant";
//   content: string;
//   confidence?: number;
//   nodes?: number;
//   timestamp?: string;
// };

// type ChatSession = {
//   id: string;
//   agentId: string;
//   agentName: string;
//   messages: Message[];
//   updatedAt: number;
// };

// /* ───────────────── API HELPERS ───────────────── */

// function authHeaders() {
//   return {
//     "Content-Type": "application/json",
//     Authorization: `Bearer ${getCookie(
//       AUTH_COOKIE_KEY
//     )}`,
//   };
// }

// async function fetchSessions(): Promise<
//   ChatSession[]
// > {
//   try {
//     const res = await fetch(
//       `${API_BASE_URL}/chat/sessions`,
//       {
//         headers: authHeaders(),
//       }
//     );

//     if (!res.ok) {
//       throw new Error(`${res.status}`);
//     }

//     const data = await res.json();

//     return Array.isArray(data)
//       ? data
//       : data.sessions || [];
//   } catch (err) {
//     console.log(err);
//     return [];
//   }
// }

// async function deleteSessionAPI(
//   sessionId: string
// ) {
//   try {
//     await fetch(
//       `${API_BASE_URL}/chat/sessions/${sessionId}`,
//       {
//         method: "DELETE",
//         headers: authHeaders(),
//       }
//     );
//   } catch (err) {
//     console.log(err);
//   }
// }

// /* ───────────────── COMPONENT ───────────────── */

// export default function ChatPlaygroundPage() {
//   const [agent, setAgent] = useState<{
//     id: string;
//     name: string;
//   } | null>(null);

//   const [sessions, setSessions] =
//     useState<ChatSession[]>([]);

//   const [sessionsLoading, setSessionsLoading] =
//     useState(true);

//   const [currentSessionId, setCurrentSessionId] =
//     useState<string | null>(null);

//   const [messages, setMessages] = useState<
//     Message[]
//   >([]);

//   const [input, setInput] = useState("");

//   const [streamingText, setStreamingText] =
//     useState("");

//   const [isTyping, setIsTyping] =
//     useState(false);

//   const [wsStatus, setWsStatus] = useState<
//     "connecting" | "open" | "closed" | "error"
//   >("closed");

//   const bottomRef =
//     useRef<HTMLDivElement>(null);

//   const ws = useRef<WebSocket | null>(null);

//   const streamingTextRef =
//     useRef<string>("");

//   const reconnectTimeoutRef =
//     useRef<NodeJS.Timeout | null>(null);

//   /* ───────────────── FETCH SESSIONS ───────────────── */

//   useEffect(() => {
//     (async () => {
//       setSessionsLoading(true);
//       const data = await fetchSessions();
//       setSessions(data);
//       setSessionsLoading(false);
//     })();

//     return () => {
//       ws.current?.close();

//       if (reconnectTimeoutRef.current) {
//         clearTimeout(
//           reconnectTimeoutRef.current
//         );
//       }
//     };
//   }, []);

//   // const loadSessions = async () => {
//   //   setSessionsLoading(true);

//   //   const data = await fetchSessions();

//   //   setSessions(data);

//   //   setSessionsLoading(false);
//   // };

//   /* ───────────────── WEBSOCKET ───────────────── */

//   const connectWs = () => {
//     if (!agent?.id) return;

//     if (ws.current) {
//       ws.current.close();
//     }

//     setWsStatus("connecting");

//     const defaultWsHost =
//       API_BASE_URL.replace(
//         /^http/,
//         "ws"
//       ).split("/api/v1")[0];

//     const wsHost =
//       process.env.NEXT_PUBLIC_WS_URL ||
//       defaultWsHost;

//     const wsUrl = `${wsHost}/api/v1/rag/ws/${agent.id}?token=${getCookie(
//       AUTH_COOKIE_KEY
//     )}`;

//     const socket = new WebSocket(wsUrl);

//     ws.current = socket;

//     /* OPEN */

//     socket.onopen = () => {
//       setWsStatus("open");

//       if (reconnectTimeoutRef.current) {
//         clearTimeout(
//           reconnectTimeoutRef.current
//         );
//       }
//     };

//     /* MESSAGE */

//     socket.onmessage = (event) => {
//       const rawData = String(event.data);

//       /* plain streaming */

//       if (
//         rawData.length === 1 ||
//         (!rawData.startsWith("{") &&
//           !rawData.startsWith("["))
//       ) {
//         streamingTextRef.current += rawData;

//         setStreamingText(
//           streamingTextRef.current
//         );

//         setIsTyping(true);

//         return;
//       }

//       try {
//         const data = JSON.parse(rawData);

//         if (data.type === "metadata")
//           return;

//         /* done */

//         if (data.type === "done") {
//           const accumulated =
//             streamingTextRef.current;

//           if (accumulated) {
//             const assistantMsg: Message = {
//               role: "assistant",
//               content: accumulated,
//               timestamp:
//                 new Date().toLocaleTimeString(
//                   [],
//                   {
//                     hour: "2-digit",
//                     minute: "2-digit",
//                   }
//                 ),
//             };

//             setMessages((prev) => [
//               ...prev,
//               assistantMsg,
//             ]);

//             /* update sidebar */

//             if (currentSessionId) {
//               setSessions((prev) =>
//                 prev.map((s) =>
//                   s.id === currentSessionId
//                     ? {
//                         ...s,
//                         messages: [
//                           ...s.messages,
//                           assistantMsg,
//                         ],
//                         updatedAt:
//                           Date.now(),
//                       }
//                     : s
//                 )
//               );
//             }
//           }

//           streamingTextRef.current = "";

//           setStreamingText("");

//           setIsTyping(false);

//           return;
//         }

//         /* chunks */

//         if (
//           [
//             "chunk",
//             "delta",
//             "content",
//             "text",
//           ].includes(data.type)
//         ) {
//           const chunk =
//             data.message ||
//             data.content ||
//             data.text ||
//             "";

//           streamingTextRef.current += chunk;

//           setStreamingText(
//             streamingTextRef.current
//           );

//           setIsTyping(true);

//           return;
//         }
//       } catch {
//         streamingTextRef.current += rawData;

//         setStreamingText(
//           streamingTextRef.current
//         );

//         setIsTyping(true);
//       }
//     };

//     /* CLOSE */

//     socket.onclose = () => {
//       setWsStatus("closed");

//       if (agent?.id) {
//         reconnectTimeoutRef.current =
//           setTimeout(() => {
//             connectWs();
//           }, 3000);
//       }
//     };

//     /* ERROR */

//     socket.onerror = () => {
//       setWsStatus("error");
//     };
//   };

//   /* connect when agent changes */

//   useEffect(() => {
//     if (agent?.id) {
//       connectWs();
//     }

//     return () => {
//       ws.current?.close();

//       if (reconnectTimeoutRef.current) {
//         clearTimeout(
//           reconnectTimeoutRef.current
//         );
//       }
//     };
//   }, [connectWs]);

//   /* scroll */

//   useEffect(() => {
//     bottomRef.current?.scrollIntoView({
//       behavior: "smooth",
//     });
//   }, [messages, streamingText]);

//   /* ───────────────── ACTIONS ───────────────── */

//   const startNewChat = (
//     selectedAgent: {
//       id: string;
//       name: string;
//     }
//   ) => {
//     const tempId = `local_${Date.now()}`;

//     const newSession: ChatSession = {
//       id: tempId,
//       agentId: selectedAgent.id,
//       agentName: selectedAgent.name,
//       messages: [],
//       updatedAt: Date.now(),
//     };

//     setSessions((prev) => [
//       newSession,
//       ...prev,
//     ]);

//     setCurrentSessionId(tempId);

//     setMessages([]);

//     setAgent(selectedAgent);
//   };

//   const loadSession = (
//     session: ChatSession
//   ) => {
//     setCurrentSessionId(session.id);

//     setMessages(session.messages);

//     setAgent({
//       id: session.agentId,
//       name: session.agentName,
//     });
//   };

//   const deleteSession = async (
//     e: React.MouseEvent,
//     id: string
//   ) => {
//     e.stopPropagation();

//     setSessions((prev) =>
//       prev.filter((s) => s.id !== id)
//     );

//     if (currentSessionId === id) {
//       setCurrentSessionId(null);

//       setMessages([]);

//       setAgent(null);
//     }

//     await deleteSessionAPI(id);
//   };

//   /* SEND */

//   const handleSend = () => {
//     const trimmed = input.trim();

//     if (
//       !trimmed ||
//       !agent?.id ||
//       wsStatus !== "open"
//     ) {
//       return;
//     }

//     const userMsg: Message = {
//       role: "user",
//       content: trimmed,
//       timestamp:
//         new Date().toLocaleTimeString([], {
//           hour: "2-digit",
//           minute: "2-digit",
//         }),
//     };

//     setMessages((prev) => [
//       ...prev,
//       userMsg,
//     ]);

//     /* update sidebar */

//     if (currentSessionId) {
//       setSessions((prev) =>
//         prev.map((s) =>
//           s.id === currentSessionId
//             ? {
//                 ...s,
//                 messages: [
//                   ...s.messages,
//                   userMsg,
//                 ],
//                 updatedAt: Date.now(),
//               }
//             : s
//         )
//       );
//     }

//     setInput("");

//     streamingTextRef.current = "";

//     setStreamingText("");

//     setIsTyping(true);

//     ws.current?.send(
//       JSON.stringify({
//         query: trimmed,
//       })
//     );
//   };

//   const handleKeyDown = (
//     e: React.KeyboardEvent<HTMLInputElement>
//   ) => {
//     if (e.key === "Enter") {
//       handleSend();
//     }
//   };

//   /* ───────────────── UI ───────────────── */

//   return (
//     <div className="h-[calc(100vh-140px)] w-full flex gap-8">

//       {/* SIDEBAR */}

//       <div className="hidden xl:flex flex-col w-84 bg-[var(--app-surface)]/40 backdrop-blur-md rounded-[32px] border border-[var(--app-border)] shadow-sm overflow-hidden">

//         <div className="p-6 border-b border-[var(--app-border)] space-y-4">

//           <Flex
//             align="center"
//             justify="space-between"
//           >
//             <Title
//               level={5}
//               className="!m-0 !text-[#285d91]"
//             >
//               Chat History
//             </Title>

//             <Button
//               type="text"
//               icon={<LuPlus />}
//               onClick={() => {
//                 setAgent(null);

//                 setCurrentSessionId(null);

//                 setMessages([]);
//               }}
//             />
//           </Flex>

//           <Input
//             prefix={<LuSearch />}
//             placeholder="Search..."
//           />
//         </div>

//         {/* SESSION LIST */}

//         <div className="flex-1 overflow-y-auto p-4 space-y-3">

//           {sessionsLoading ? (
//             <Flex
//               vertical
//               align="center"
//               justify="center"
//               className="h-full"
//             >
//               <Text>
//                 Loading history...
//               </Text>
//             </Flex>
//           ) : sessions.length > 0 ? (
//             sessions.map((s) => (
//               <div
//                 key={s.id}
//                 onClick={() =>
//                   loadSession(s)
//                 }
//                 className={`group p-4 rounded-2xl cursor-pointer border transition-all ${
//                   currentSessionId === s.id
//                     ? "bg-[#285d91] text-white"
//                     : "bg-[var(--app-surface-muted)]"
//                 }`}
//               >
//                 <div className="flex justify-between items-start mb-2">

//                   <Text
//                     className={`font-bold text-xs truncate ${
//                       currentSessionId ===
//                       s.id
//                         ? "text-white"
//                         : ""
//                     }`}
//                   >
//                     {s.messages.length > 0
//                       ? s.messages[0]
//                           .content
//                       : s.agentName}
//                   </Text>

//                   <FiTrash2
//                     onClick={(e) =>
//                       deleteSession(
//                         e,
//                         s.id
//                       )
//                     }
//                     className="opacity-0 group-hover:opacity-100"
//                   />
//                 </div>

//                 <div className="flex justify-between items-center">

//                   <Text className="text-[10px]">
//                     {new Date(
//                       s.updatedAt
//                     ).toLocaleDateString()}
//                   </Text>

//                   <div className="text-[9px]">
//                     {s.messages.length} msgs
//                   </div>
//                 </div>
//               </div>
//             ))
//           ) : (
//             <Flex
//               vertical
//               align="center"
//               justify="center"
//               className="h-full"
//             >
//               <LuHistory size={30} />

//               <Text>
//                 No sessions found
//               </Text>
//             </Flex>
//           )}
//         </div>
//       </div>

//       {/* MAIN CHAT */}

//       <Flex
//         vertical
//         className="flex-1 bg-[var(--app-surface)] rounded-[40px] border overflow-hidden"
//       >

//         {/* HEADER */}

//         <Flex
//           justify="space-between"
//           align="center"
//           className="px-10 py-8 border-b"
//         >
//           <Flex align="center" gap={16}>

//             <div className="w-14 h-14 rounded-2xl bg-[#285d91] text-white flex items-center justify-center">
//               <LuBot size={28} />
//             </div>

//             <Flex vertical>

//               <Title
//                 level={3}
//                 className="!m-0"
//               >
//                 {agent?.name ||
//                   "Neural Assistant"}
//               </Title>

//               <Flex
//                 align="center"
//                 gap={6}
//               >
//                 <Badge
//                   status={
//                     wsStatus === "open"
//                       ? "success"
//                       : "processing"
//                   }
//                 />

//                 <Text className="text-xs">
//                   {wsStatus}
//                 </Text>
//               </Flex>
//             </Flex>
//           </Flex>

//           <AgentList
//             selectedId={agent?.id}
//             onChange={(
//               id: string,
//               name: string
//             ) => {
//               startNewChat({
//                 id,
//                 name,
//               });
//             }}
//           />
//         </Flex>

//         {/* CHAT AREA */}

//         <div className="flex-1 overflow-y-auto px-10 py-10 space-y-8">

//           {messages.map((msg, i) => (
//             <Flex
//               key={i}
//               justify={
//                 msg.role === "user"
//                   ? "flex-end"
//                   : "flex-start"
//               }
//             >
//               <div className="flex flex-col max-w-[75%] gap-2">

//                 <Flex
//                   align="center"
//                   gap={8}
//                 >
//                   <Avatar
//                     icon={
//                       msg.role ===
//                       "user" ? (
//                         <FiUser />
//                       ) : (
//                         <LuBot />
//                       )
//                     }
//                   />

//                   <Text className="text-xs">
//                     {msg.timestamp}
//                   </Text>
//                 </Flex>

//                 <div
//                   className={`p-6 rounded-[32px] ${
//                     msg.role === "user"
//                       ? "bg-[#285d91] text-white"
//                       : "bg-gray-100"
//                   }`}
//                 >
//                   <p className="whitespace-pre-wrap">
//                     {msg.content}
//                   </p>

//                   {msg.role ===
//                     "assistant" &&
//                     (msg.confidence ||
//                       msg.nodes) && (
//                       <div className="mt-5 flex gap-4">

//                         {msg.confidence && (
//                           <Tooltip title="Confidence">
//                             <span className="flex items-center gap-2 text-xs">
//                               <MdBarChart />
//                               {
//                                 msg.confidence
//                               }
//                               %
//                             </span>
//                           </Tooltip>
//                         )}

//                         {msg.nodes && (
//                           <Tooltip title="Nodes">
//                             <span className="flex items-center gap-2 text-xs">
//                               <PiGraphLight />
//                               {
//                                 msg.nodes
//                               }{" "}
//                               Nodes
//                             </span>
//                           </Tooltip>
//                         )}
//                       </div>
//                     )}
//                 </div>
//               </div>
//             </Flex>
//           ))}

//           {/* STREAM */}

//           {isTyping && (
//             <Flex justify="flex-start">

//               <div className="flex flex-col gap-2">

//                 <Flex
//                   align="center"
//                   gap={8}
//                 >
//                   <Avatar
//                     icon={<LuBot />}
//                   />

//                   <Text className="text-xs">
//                     Thinking...
//                   </Text>
//                 </Flex>

//                 <div className="p-6 bg-gray-100 rounded-[32px]">

//                   <p className="whitespace-pre-wrap">
//                     {streamingText ||
//                       "Synthesizing response..."}
//                   </p>
//                 </div>
//               </div>
//             </Flex>
//           )}

//           <div ref={bottomRef} />
//         </div>

//         {/* INPUT */}

//         <div className="px-10 py-10 border-t">

//           <div className="relative">

//             <Input
//               value={input}
//               onChange={(e) =>
//                 setInput(
//                   e.target.value
//                 )
//               }
//               onKeyDown={
//                 handleKeyDown
//               }
//               placeholder={
//                 agent
//                   ? `Query ${agent.name}...`
//                   : "Select agent..."
//               }
//               // disabled={
//               //   !agent ||
//               //   wsStatus !== "open"
//               // }
//               className="!h-20 !pl-8 !pr-24 !rounded-[24px]"
//             />

//             <button
//               onClick={handleSend}
//               disabled={
//                 !agent ||
//                 !input.trim() ||
//                 wsStatus !== "open"
//               }
//               className="absolute right-4 top-4 w-12 h-12 bg-[#285d91] text-white rounded-2xl flex items-center justify-center"
//             >
//               <FiSend size={22} />
//             </button>
//           </div>
//         </div>
//       </Flex>
//     </div>
//   );
// }