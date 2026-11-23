import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Lock, Mail, Loader2, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';

interface Props {
  onLoginSuccess: () => void;
}

export const LoginView: React.FC<Props> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawEmail = email.trim();
    if (!rawEmail || !password.trim()) {
      setErrorMsg('Por favor ingresa tu usuario o correo y contraseña.');
      return;
    }

    // Si el texto ingresado no contiene "@", concatenar automáticamente "@ynacaja.app"
    const emailFinal = rawEmail.includes('@')
      ? rawEmail
      : `${rawEmail.toLowerCase()}@ynacaja.app`;

    setCargando(true);
    setErrorMsg(null);

    if (!supabase) {
      setErrorMsg('Supabase no está configurado. Revisa las variables de entorno.');
      setCargando(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailFinal,
        password: password.trim(),
      });

      if (error) {
        const errorDescription = (error as any)?.error_description;
        let strObj = '';
        try {
          const s = JSON.stringify(error);
          if (s && s !== '{}') strObj = s;
        } catch {}

        const mensajeCrudo =
          (error?.message && error.message !== '{}' ? error.message : null) ||
          errorDescription ||
          strObj ||
          'Error al iniciar sesión';

        setErrorMsg(
          mensajeCrudo === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos. Verifica tus datos.'
            : mensajeCrudo
        );
        setCargando(false);
        return;
      }

      if (data?.session) {
        onLoginSuccess();
      }
    } catch (err: any) {
      let strErr = '';
      try {
        const s = JSON.stringify(err);
        if (s && s !== '{}') strErr = s;
      } catch {}
      const fallbackMsg =
        (err?.message && err.message !== '{}' ? err.message : null) ||
        err?.error_description ||
        strErr ||
        'Error al iniciar sesión';
      setErrorMsg(fallbackMsg);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F4F5] flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo y Encabezado */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-[#2C474E] text-white shadow-md mb-3">
            <img src="/logo.svg" alt="YnaCaja" className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#18181B]">
            YnaCaja
          </h1>
          <p className="text-xs text-[#52525B] font-medium uppercase tracking-wider mt-0.5">
            Chicha Adictiva • Control de Caja
          </p>
        </div>

        {/* Tarjeta de Formulario */}
        <div className="bg-white border border-[#E4E4E7] rounded-xl p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F4F4F5]">
            <ShieldCheck size={18} className="text-[#2C474E]" />
            <h2 className="text-sm font-bold text-[#18181B]">
              Iniciar Sesión
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#52525B] mb-1">
                Usuario o Correo Electrónico
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-3 text-[#A1A1AA]" />
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ej. puesto1 o correo@ejemplo.com"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                />
              </div>
              {email.trim() && !email.includes('@') && (
                <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                  Acceso como: <span className="text-[#2C474E] font-bold">{email.trim().toLowerCase()}@ynacaja.app</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#52525B] mb-1">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-3 text-[#A1A1AA]" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-[#E4E4E7] rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#991B1B] flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="w-full min-h-[44px] px-4 py-2.5 bg-[#2C474E] text-white rounded-lg font-bold text-xs sm:text-sm hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-2 transition-colors disabled:opacity-70 shadow-xs"
            >
              {cargando ? (
                <>
                  <Loader2 size={16} className="animate-spin text-white" />
                  <span>Ingresando...</span>
                </>
              ) : (
                <>
                  <span>Ingresar a YnaCaja</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#F4F4F5] text-center">
            <span className="text-[11px] text-[#71717A]">
              Acceso seguro para Administrador y Vendedores de Puestos
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
