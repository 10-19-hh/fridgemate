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

function SignupSession() {
  const navigate = useNavigate();
  const { backendEnabled, isAuthenticated, loading, signup } = useAuth();
  const { trackEvent } = useAnalytics();
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const publicSignupEnabled = isPublicSignupEnabled();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Let an active submit finish its feedback before the authenticated redirect.
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
    if (!mounted.current || pending.current || loading || !backendEnabled || !publicSignupEnabled || isAuthenticated) return;
    const requestPath = window.location.pathname;
    const requestHistoryKey = window.history.state?.key;
    const isCurrentPage = () => mounted.current && window.location.pathname === requestPath
      && window.history.state?.key === requestHistoryKey;
    pending.current = true;
    setSubmitting(true);
    setError('');
    let completed = false;

    try {
      await signup(form);
      if (!isCurrentPage()) return;
      trackEvent('signup_completed', {
        source_screen: 'signup'
      });
      navigate('/account', { replace: true });
      completed = true;
    } catch (nextError) {
      if (isCurrentPage()) setError(nextError.message || '\uD68C\uC6D0\uAC00\uC785\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694.');
    } finally {
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
        title={'\uACC4\uC815\uC744 \uB9CC\uB4E4\uACE0 \uB0B4 \uC800\uC7A5\uC18C\uB97C \uC2DC\uC791\uD558\uC138\uC694'}
        description={
          '\uD68C\uC6D0\uAC00\uC785 \uD6C4\uC5D0\uB294 \uACC4\uC815 \uAE30\uBC18 \uC7AC\uB8CC \uD750\uB984\uACFC \uC138\uC158 \uBCF5\uC6D0\uC744 \uC0AC\uC6A9\uD558\uAC8C \uB429\uB2C8\uB2E4.'
        }
      />

      {!backendEnabled ? (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-900">
          {'\uD604\uC7AC\uB294 \uB85C\uCEEC \uC804\uC6A9 \uBAA8\uB4DC\uC5EC\uC11C \uD68C\uC6D0\uAC00\uC785 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC5B4\uC694.'}
        </div>
      ) : null}

      {!publicSignupEnabled ? (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-900">
          {'\uC774\uBA54\uC77C \uD655\uC778 \uAE30\uB2A5\uC744 \uC900\uBE44\uD558\uB294 \uB3D9\uC548 \uC2E0\uADDC \uD68C\uC6D0\uAC00\uC785\uC744 \uC77C\uC2DC \uC911\uB2E8\uD588\uC5B4\uC694. \uAE30\uC874 \uACC4\uC815\uC740 \uB85C\uADF8\uC778\uD560 \uC218 \uC788\uACE0, \uACC4\uC815 \uC5C6\uC774\uB3C4 \uC774 \uAE30\uAE30\uC5D0\uC11C \uB0C9\uC7A5\uACE0 \uAE30\uB2A5\uC744 \uACC4\uC18D \uC0AC\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.'}
        </div>
      ) : null}

      {error ? <div role="alert" className="card border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div> : null}

      {publicSignupEnabled ? <form className="card max-w-xl space-y-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <span className="summary-chip">{backendEnabled ? '\uACC4\uC815 \uC0DD\uC131 \uAC00\uB2A5' : '\uB85C\uCEEC \uC804\uC6A9 \uBAA8\uB4DC'}</span>
          <span className="summary-chip">{'\uBE44\uBC00\uBC88\uD638 8\uC790 + \uD2B9\uC218\uBB38\uC790'}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
            {'\uC774\uBA54\uC77C'}
            <input required autoComplete="username" spellCheck={false} name="email" type="email" value={form.email} onChange={handleChange} />
          </label>

          <label className="space-y-1.5 text-sm font-medium text-slate-700 md:col-span-2">
            {'\uBE44\uBC00\uBC88\uD638'}
            <input required autoComplete="new-password" minLength={8} maxLength={128} name="password" type="password" value={form.password} onChange={handleChange} />
            <span className="block text-xs font-normal text-slate-500">
              {'8\uC790 \uC774\uC0C1, \uD2B9\uC218\uBB38\uC790 \uD3EC\uD568, \uC774\uBA54\uC77C \uC77C\uBD80\uB098 \uC26C\uC6B4 \uD328\uD134\uC744 \uD53C\uD55C \uBE44\uBC00\uBC88\uD638\uB97C \uC0AC\uC6A9\uD574\uC8FC\uC138\uC694.'}
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-white/70 pt-1">
          <button className="btn-primary" disabled={!backendEnabled || loading || submitting} type="submit">
            {submitting ? '\uACC4\uC815 \uB9CC\uB4DC\uB294 \uC911...' : '\uD68C\uC6D0\uAC00\uC785'}
          </button>
          <Link className="btn-secondary" to="/login">
            {'\uC774\uBBF8 \uACC4\uC815\uC774 \uC788\uC5B4\uC694'}
          </Link>
        </div>
      </form> : null}
    </div>
  );
}

function SignupPage() {
  const location = useLocation();
  return <SignupSession key={location.key} />;
}

export default SignupPage;
