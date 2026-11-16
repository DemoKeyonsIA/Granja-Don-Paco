import React, { useState } from 'react';
import { LogIn, AlertCircle } from 'lucide-react';
import { Spinner } from './Spinner';
import { saveSession } from '../lib/session';
import { toast } from 'sonner';
import { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

const DEMO_ACCOUNTS = [
  'admin@granja.com',
  'facturacion@granja.com',
  'vendedor@granja.com',
  'socio@granja.com',
  'bodega@granja.com',
  'despacho@granja.com',
  'camionero@granja.com',
];

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Credenciales incorrectas. Accesos demo (Clave: 1234): ${DEMO_ACCOUNTS.join(', ')}`);
      }
      saveSession({ token: data.token, user: data.user }, remember);
      onLogin(data.user);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const autofill = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword('1234');
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4" style={{ background: 'var(--bg-page)' }}>
      <div className="max-w-md w-full rounded-3xl shadow-2xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="pt-10 pb-8 px-6 text-center relative overflow-hidden" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-on-sidebar)' }}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-15 -translate-y-1/2 translate-x-1/3" style={{ background: 'var(--brand-primary)' }} />
          <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full opacity-15 translate-y-1/2 -translate-x-1/4" style={{ background: 'var(--brand-primary)' }} />
          <div className="relative">
            <div className="mx-auto mb-4 flex h-24 w-44 max-w-full items-center justify-center overflow-hidden rounded-xl border border-white/30 bg-white shadow-sm">
              <img
                src="/granja-don-paco-logo.png"
                alt="Granja Don Paco · Siempre frescos"
                width={447}
                height={447}
                draggable={false}
                className="h-full w-full object-cover object-center"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Granja Don Paco</h1>
            <p className="text-sm font-medium mt-2 opacity-80" style={{ color: 'var(--text-on-sidebar)' }}>Origen cuidado · calidad cercana</p>
          </div>
        </div>
        
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 rounded-xl text-sm border border-red-100 dark:border-red-800/30 flex items-start animate-in fade-in zoom-in-95">
                <AlertCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1.5">Correo Electrónico</label>
              <input 
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-stone-200 dark:border-neutral-600 px-4 py-3 text-stone-800 dark:text-white bg-stone-50 dark:bg-neutral-700/50 focus:border-transparent focus:ring-2 transition-all outline-none"
                style={{ '--tw-ring-color': 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' } as any}
                placeholder="usuario@granja.com"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1.5">Contraseña</label>
              <input 
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-200 dark:border-neutral-600 px-4 py-3 text-stone-800 dark:text-white bg-stone-50 dark:bg-neutral-700/50 focus:border-transparent focus:ring-2 transition-all outline-none"
                style={{ '--tw-ring-color': 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' } as any}
                placeholder="••••"
                required
              />
            </div>
            
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-stone-300 dark:border-neutral-600"
                  style={{ accentColor: 'var(--brand-primary)' }}
                />
                Recordarme en este equipo
              </label>
              <button
                type="button"
                onClick={() => toast.info('Contacta al administrador para restablecer tu contraseña. En demo usa la clave 1234.')}
                className="text-xs font-bold transition-colors"
                style={{ color: 'var(--text-link)' }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center font-bold py-3.5 px-4 rounded-xl shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-60"
              style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}
            >
              {loading ? <Spinner className="mr-2" /> : <LogIn className="w-5 h-5 mr-2" />}
              {loading ? 'Verificando...' : 'Ingresar al Sistema'}
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-stone-100 dark:border-neutral-700">
            <p className="text-xs text-stone-400 dark:text-stone-500 font-semibold uppercase tracking-wider text-center mb-3">Accesos Rápidos (Demo)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <DemoRoleButton label="Administrador" onClick={() => autofill('admin@granja.com')} />
              <DemoRoleButton label="Comercial · ventas y reparto" onClick={() => autofill('vendedor@granja.com')} />
              <DemoRoleButton label="Socio" onClick={() => autofill('socio@granja.com')} />
              <DemoRoleButton label="Bodeguero" onClick={() => autofill('bodega@granja.com')} />
              <DemoRoleButton label="Encargado de granja" onClick={() => autofill('despacho@granja.com')} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoRoleButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold py-2.5 px-2 rounded-xl transition-colors border hover:brightness-95"
      style={{
        background: 'var(--bg-muted)',
        color: 'var(--text-secondary)',
        borderColor: 'var(--border-default)',
      }}
    >
      {label}
    </button>
  );
}
