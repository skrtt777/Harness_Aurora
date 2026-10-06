// "Sobre você": who the person is, in every conversation (OpenClaw's USER.md). Two parts: what the
// person wrote (Configurações → Geral) and what the Aurora learned when the person said it about
// themselves ("meu nome é…", "trabalho com…"), each line removable. Before this, a name said in
// one conversation was gone in the next.
import { getSetting, setSetting } from "./store.js";

const SELF = /\b(meu nome [ée]|me chamo|pode me chamar de|eu sou (o|a)\b|trabalho (com|na|no|em|como)|cuido d[aoe]s?|sou respons[áa]vel|minha empresa|prefiro que|moro em)/i;
const NAME = /\b(?:[Mm]eu nome é|[Mm]e chamo|[Pp]ode me chamar de)\s+([A-ZÀ-Ú][\p{L}]+(?: [A-ZÀ-Ú][\p{L}]+)?)/u;
const MAX_LEARNED = 12;

export async function getProfile() {
  let learned = [];
  try { learned = JSON.parse((await getSetting("user_profile_learned")) || "[]"); } catch { /* none */ }
  return { text: (await getSetting("user_profile")) || "", learned: Array.isArray(learned) ? learned : [] };
}

export async function saveProfile({ text, learned }) {
  if (text !== undefined) await setSetting("user_profile", String(text).slice(0, 1500));
  if (learned !== undefined) await setSetting("user_profile_learned", JSON.stringify((Array.isArray(learned) ? learned : []).slice(-MAX_LEARNED)));
  return getProfile();
}

/**
 * The sentence where the person speaks about themselves, kept as a fact. A name replaces the old one
 * ("Nome: Rafaela"); other facts are added once each.
 */
export async function learnFromMessage(message) {
  const text = String(message || "");
  if (!SELF.test(text)) return null;
  const profile = await getProfile();
  const name = text.match(NAME)?.[1];
  const sentence = text.split(/(?<=[.!?])\s+|\n/).find((s) => SELF.test(s) && !NAME.test(s))?.trim().replace(/^(oi|olá|ola)[!,.\s]*/i, "").slice(0, 180);
  let learned = profile.learned;
  const date = new Date().toISOString().slice(0, 10);
  if (name) learned = [...learned.filter((l) => !l.text.startsWith("Nome: ")), { text: `Nome: ${name}`, at: date }];
  if (sentence && sentence.length >= 8 && !learned.some((l) => l.text.toLowerCase() === sentence.toLowerCase())) learned = [...learned, { text: sentence, at: date }];
  if (learned === profile.learned) return null;
  await saveProfile({ learned });
  return learned;
}

/** The profile as a context block (empty when there is nothing). */
export async function profileBlock() {
  const { text, learned } = await getProfile();
  if (!text.trim() && !learned.length) return [];
  // In a new conversation "qual é o meu nome?" got the Windows account in the folder paths
  // ("Lucas") over "Nome: Rafaela" here (battery, 2 runs in 3, 06/10): the name is said plainly.
  const name = learned.map((l) => /^Nome: (.+)$/.exec(l.text)?.[1]).find(Boolean);
  const nameLine = name ? [`A pessoa se chama ${name}. Se ela perguntar o próprio nome, é ${name} (o nome nos caminhos das pastas é só a conta do Windows).`] : [];
  return [`Sobre a pessoa (perfil que vale em todas as conversas; use quando ajudar, como o nome):\n${[...nameLine, text.trim(), ...learned.filter((l) => !/^Nome: /.test(l.text)).map((l) => `- ${l.text}`)].filter(Boolean).join("\n").slice(0, 1200)}`];
}
