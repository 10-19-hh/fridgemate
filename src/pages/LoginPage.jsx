import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { useAnalytics } from '../hooks/useAnalytics';
import { useAuth } from '../hooks/useAuth';
import { isPublicSignupEnabled } from '../utils/backendConfig';

const defaultForm = {
  email: '',
  password: ''
};

function LoginSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { backendEnabled, error: authError, isAuthenticated, loading, login } = useAuth();
  const { trackEvent } = useAnalytics();
  const [form, setForm] = useState(defaultForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const visibleError = formError || authError;
  const publicSignupEnabled = isPublicSignupEnabled();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The active submit owns its completion and original destination. A provider
  // session update must not unmount it before that acknowledgement is handled.
  if (isAuthenticated && !submitting) {
    return <Navigate replace to="/account" />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!mounted.current || pending.current || loading || !backendEnabled || isAuthenticated) return;
    const requestPath = window.location.pathname;
    const requestHistoryKey = window.history.state?.key;
    const isCurrentPage = () => mounted.current && window.location.pathname === requestPath
      && window.history.state?.key === requestHistoryKey;
    pending.current = true;
    setSubmitting(true);
    setFormError('');
    let completed = false;

    try {
      await login(form);
      if (!isCurrentPage()) return;
      trackEvent('login_completed', {
        restored_session: false,
        source_screen: 'login'
      });
      navigate(location.state?.from?.pathname || '/account', { replace: true });
      completed = true;
    } catch (nextError) {
      if (isCurrentPage()) setFormError(nextError.message || '\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694.');
    } finally {
      // Keep the success redirect in control while the router commits it.
      // History can move before a suspended destination unmounts this page.
      if (!completed && isCurrentPage()) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="section-shell">
      <PageHeader
        eyebrow={'\uACC4\uC815'}
        title={'\uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uACE0 \uC11C\uBC84 \uC5F0\uB3D9 \uBAA8\uB4DC\uB85C \uC804\uD658\uD558\uC138\uC694'}
        description={
          '\uB85C\uADF8\uC778 \uD6C4\uC5D0\uB294 \uACC4\uC815 \uAE30\uBC18 \uC800\uC7A5\uC18C\uC640 API \uD750\uB984\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4.'
        }
      />

      {!backendEnabled ? (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-900">
          {'\uD604\uC7AC\uB294 \uB85C\uCEEC \uC804\uC6A9 \uBAA8\uB4DC\uC5EC\uC11C \uB85C\uADF8\uC778 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC5B4\uC694.'}
        </div>
      ) : null}

      {visibleError ? (
        <div role="alert" className="card border border-rose-200 bg-rose-50 text-sm text-rose-700">{visibleError}</div>
      ) : null}

      <form className="card max-w-xl space-y-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <span className="summary-chip">{backendEnabled ? '\uC11C\uBC84 \uC5F0\uB3D9 \uAC00\uB2A5' : '\uB85C\uCEEC \uC804\uC6A9 \uBAA8\uB4DC'}</span>
          <span className="summary-chip">{'\uAC8C\uC2A4\uD2B8 \uB370\uC774\uD130\uB294 \uBCC4\uB3C4 \uC720\uC9C0'}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
            {'\uC774\uBA54\uC77C'}
            <input required autoComplete="username" spellCheck={false} name="email" type="email" value={form.email} onChange={handleChange} />
          </label>

          <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
            {'\uBE44\uBC00\uBC88\uD638'}
            <input required autoComplete="current-password" name="password" type="password" value={form.password} onChange={handleChange} />
          </label>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-white/70 pt-1">
          <button className="btn-primary" disabled={!backendEnabled || loading || submitting} type="submit">
            {submitting ? '\uB85C\uADF8\uC778 \uC911...' : '\uB85C\uADF8\uC778'}
          </button>
          {publicSignupEnabled ? (
            <Link className="btn-secondary" to="/signup">
              {'\uD68C\uC6D0\uAC00\uC785'}
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function LoginPage() {
  const location = useLocation();
  return <LoginSession key={location.key} />;
}

export default LoginPage;
