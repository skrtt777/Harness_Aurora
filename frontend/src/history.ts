export type ChatMessage = { id:string; role:'user'|'assistant'; content:string; createdAt:string; provider?:string; memoryAccess?:string[] };
export type Conversation = { id:string; title:string; messages:ChatMessage[]; createdAt:string; updatedAt:string };
const key='ai-harness-conversations-v1';
export function newConversation():Conversation { const now=new Date().toISOString(); return {id:`conversation-${Date.now()}`,title:'Nova conversa',messages:[],createdAt:now,updatedAt:now}; }
export function loadConversations():Conversation[] { try { const raw=localStorage.getItem(key); const parsed=raw?JSON.parse(raw):[]; return Array.isArray(parsed)?parsed:[]; } catch { return []; } }
export function saveConversations(items:Conversation[]){ localStorage.setItem(key,JSON.stringify(items.slice(0,100))); }
export function addMessage(conversation:Conversation,message:ChatMessage):Conversation { const title=conversation.title==='Nova conversa'&&message.role==='user'?message.content.slice(0,42)+(message.content.length>42?'…':''):conversation.title; return {...conversation,title,messages:[...conversation.messages,message],updatedAt:message.createdAt}; }
