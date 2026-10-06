import { useEffect, useState } from 'react';
import { getUserProfile, saveUserProfile, type UserProfile } from './api';

/**
 * "Sobre você": a few lines the Aurora reads in every conversation (who you are, how you like the
 * answers), plus what it learned when you said it about yourself — each one removable.
 */
export default function ProfilePanel() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void getUserProfile().then((p) => { setProfile(p); setDraft(p.text); }).catch(() => setError('Não foi possível carregar.')); }, []);
  if (!profile) return <p className="section-desc">{error || 'Carregando…'}</p>;
  const save = (patch: Partial<UserProfile>) => void saveUserProfile(patch).then((p) => { setProfile(p); setSaved(true); setTimeout(() => setSaved(false), 1800); }).catch((e: Error) => setError(e.message));

  return <div className="profile-panel">
    <textarea className="field" rows={3} maxLength={1500} aria-label="Sobre você" value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== profile.text) save({ text: draft }); }}
      placeholder="Ex.: Sou a Rafaela, cuido das parcerias de uma agência de marketing. Prefiro respostas curtas e em tópicos." />
    <div className="form-actions">
      {saved && <span className="settings-saved">Salvo</span>}
      <button className="btn" disabled={draft === profile.text} onClick={() => save({ text: draft })}>Salvar</button>
    </div>
    {profile.learned.length > 0 && <div className="profile-learned">
      <p className="section-desc">O que a Aurora aprendeu com você nas conversas:</p>
      <ul aria-label="Aprendido nas conversas">
        {profile.learned.map((l) => <li key={l.text}>
          <span>{l.text}</span>
          <button type="button" className="btn btn-text btn-sm" aria-label={`Esquecer: ${l.text}`} onClick={() => save({ learned: profile.learned.filter((x) => x.text !== l.text) })}>Esquecer</button>
        </li>)}
      </ul>
    </div>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </div>;
}
