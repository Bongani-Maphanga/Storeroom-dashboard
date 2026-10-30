
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import './App.css';

const STOREROOM_ID = '0134a4e7-974f-4c7e-877f-5a656949d138';
const fmtDate = (v) => v ? new Date(v).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const errMsg = (e) => e?.message || 'An unexpected error occurred.';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      if (error) throw error;
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">S</div>
        <p className="eyebrow">STOREROOM MANAGEMENT</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to view your storeroom dashboard.</p>

        {error && <div className="notice error-notice" role="alert">{error}</div>}

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button className="primary-button full-width" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-footer">
          Access is determined by your storeroom membership.
        </p>
      </form>
    </main>
  );
}

function Metric({ label, value, description, icon }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-value">{value}</div>
      <p className="metric-description">{description}</p>
    </article>
  );
}

function Badge({ status }) {
  const s = String(status || 'unknown').toLowerCase();
  return (
    <span className={`status-badge status-${s.replace(/[^a-z0-9_-]/g, '-')}`}>
      {status || 'Unknown'}
    </span>
  );
}

function Dashboard({ session, signOut }) {
  const [role, setRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState('');

  const [products, setProducts] = useState([]);
  const [reading, setReading] = useState(null);
  const [alerts, setAlerts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [threshold, setThreshold] = useState('3');
  const [initialStock, setInitialStock] = useState('0');

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const loadRole = useCallback(async () => {
    setRoleLoading(true);
    setRoleError('');
    setRole(null);

    try {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('storeroom_id', STOREROOM_ID)
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!data || !['admin', 'viewer'].includes(data.role)) {
        throw new Error(
          'No valid admin or viewer membership was found for this storeroom.'
        );
      }

      setRole(data.role);
    } catch (e) {
      setRoleError(errMsg(e));
    } finally {
      setRoleLoading(false);
    }
  }, [session.user.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setDataError('');

    try {
      const [p, r, a] = await Promise.all([
        supabase
          .from('products')
          .select('id,name,current_stock,low_stock_level,active')
          .eq('storeroom_id', STOREROOM_ID)
          .eq('active', true)
          .order('name'),

        supabase
          .from('sensor_readings')
          .select('id,temperature_c,humidity_pct,recorded_at')
          .eq('storeroom_id', STOREROOM_ID)
          .order('recorded_at', { ascending: false })
          .limit(1),

        supabase
          .from('alerts')
          .select('id,alert_type,severity,message,status,created_at')
          .eq('storeroom_id', STOREROOM_ID)
          .order('created_at', { ascending: false })
          .limit(10)
      ]);

      if (p.error) throw p.error;
      if (r.error) throw r.error;
      if (a.error) throw a.error;

      setProducts(p.data || []);
      setReading(r.data?.[0] || null);
      setAlerts(a.data || []);

      setProductId(old =>
        old && (p.data || []).some(x => x.id === old)
          ? old
          : (p.data || [])[0]?.id || ''
      );
    } catch (e) {
      setDataError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRole();
  }, [loadRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ==========================================================
  // SUPABASE REALTIME
  // Automatically refresh the dashboard when database rows
  // change. This removes the need for manual page refreshing.
  // ==========================================================

  useEffect(() => {
    let refreshTimer;

    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        loadData();
      }, 150);
    };

    const channel = supabase
      .channel(`storeroom-live-${STOREROOM_ID}`)

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `storeroom_id=eq.${STOREROOM_ID}`
        },
        refresh
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sensor_readings',
          filter: `storeroom_id=eq.${STOREROOM_ID}`
        },
        refresh
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `storeroom_id=eq.${STOREROOM_ID}`
        },
        refresh
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stock_events',
          filter: `storeroom_id=eq.${STOREROOM_ID}`
        },
        refresh
      )

      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Dashboard live updates:', status);
        }
      });

    return () => {
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const admin = role === 'admin';

  const low = products.filter(
    p => (Number(p.current_stock) || 0) <=
         (Number(p.low_stock_level) || 0)
  );

  const open = alerts.filter(
    a => String(a.status).toLowerCase() === 'open'
  );

  async function addProduct(e) {
    e.preventDefault();
    setActionError('');
    setSuccess('');

    const t = Number(threshold);
    const q = Number(initialStock);

    if (!admin) {
      setActionError('Administrator access is required.');
      return;
    }

    if (
      !name.trim() ||
      !Number.isInteger(t) ||
      t < 0 ||
      !Number.isInteger(q) ||
      q < 0
    ) {
      setActionError(
        'Enter a product name and valid non-negative whole numbers.'
      );
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.rpc('admin_create_product', {
        p_storeroom_id: STOREROOM_ID,
        p_name: name.trim(),
        p_sku: sku.trim() || null,
        p_low_stock_level: t,
        p_initial_stock: q
      });

      if (error) throw error;

      setName('');
      setSku('');
      setThreshold('3');
      setInitialStock('0');
      setSuccess('Product added successfully.');

      await loadData();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function restock(e) {
    e.preventDefault();
    setActionError('');
    setSuccess('');

    const q = Number(quantity);

    if (!admin) {
      setActionError('Administrator access is required.');
      return;
    }

    if (!productId || !Number.isInteger(q) || q <= 0) {
      setActionError(
        'Select a product and enter a positive whole quantity.'
      );
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.rpc('admin_restock_product', {
        p_storeroom_id: STOREROOM_ID,
        p_product_id: productId,
        p_quantity: q,
        p_note: note.trim() || null
      });

      if (error) throw error;

      setQuantity('1');
      setNote('');
      setSuccess('Stock updated successfully.');

      await loadData();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small-mark">S</div>
          <div>
            <h2>Storeroom</h2>
            <p>Management system</p>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#overview">▦ &nbsp; Overview</a>
          <a className="nav-link" href="#inventory">▤ &nbsp; Inventory</a>
          <a className="nav-link" href="#environment">◉ &nbsp; Environment</a>
          <a className="nav-link" href="#alerts">♧ &nbsp; Alerts</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">
              {(session.user.email || 'U')[0].toUpperCase()}
            </div>
            <div className="user-details">
              <span className="user-name">Signed in</span>
              <span className="sidebar-email">{session.user.email}</span>
              <span className={`sidebar-role ${
                roleLoading || roleError
                  ? 'unverified'
                  : admin ? 'admin' : 'viewer'
              }`}>
                {roleLoading
                  ? 'CHECKING ROLE…'
                  : roleError
                    ? 'ROLE UNVERIFIED'
                    : admin ? 'ADMIN' : 'VIEWER'}
              </span>
            </div>
          </div>

          <button
            className="secondary-button signout-button"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">MAIN STOREROOM</p>
            <h1>Dashboard overview</h1>
            <p className="muted">
              Monitor stock levels and environmental conditions.
            </p>
          </div>

          <button
            className="secondary-button refresh-button"
            onClick={loadData}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </header>

        {roleError && (
          <div className="notice error-notice role-error" role="alert">
            <div>
              <strong>Unable to verify your role.</strong>
              <p>{roleError}</p>
              <p>
                Administrative actions remain unavailable until your
                membership is verified.
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={loadRole}
              disabled={roleLoading}
            >
              Retry
            </button>
          </div>
        )}

        {dataError && (
          <div className="notice error-notice" role="alert">
            <div>
              <strong>Unable to load dashboard data.</strong>
              <p>{dataError}</p>
            </div>
            <button
              className="secondary-button"
              onClick={loadData}
              disabled={loading}
            >
              Retry
            </button>
          </div>
        )}

        <section id="overview" className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>At a glance</h2>
              <p>Current stock and alert summary</p>
            </div>
            {loading && <span className="loading-label">Loading data…</span>}
          </div>

          <div className="metrics-grid">
            <Metric
              label="Active products"
              value={loading ? '—' : products.length}
              description="Products currently tracked"
              icon="▤"
            />
            <Metric
              label="Total units"
              value={loading ? '—' : products.reduce(
                (n, p) => n + (Number(p.current_stock) || 0), 0
              )}
              description="Units across active products"
              icon="▦"
            />
            <Metric
              label="Low stock"
              value={loading ? '—' : low.length}
              description="Products at or below threshold"
              icon="!"
            />
            <Metric
              label="Open alerts"
              value={loading ? '—' : open.length}
              description="Open alerts in the latest records"
              icon="♧"
            />
          </div>
        </section>

        <section id="environment" className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Environment</h2>
              <p>Latest sensor reading from the storeroom</p>
            </div>
          </div>

          <div className="environment-card">
            {reading ? (
              <>
                <div className="environment-reading">
                  <div className="environment-symbol temperature-symbol">°C</div>
                  <div>
                    <p className="reading-label">Temperature</p>
                    <p className="reading-value">
                      {reading.temperature_c == null
                        ? '—'
                        : `${Number(reading.temperature_c).toFixed(1)}°C`}
                    </p>
                  </div>
                </div>

                <div className="environment-divider" />

                <div className="environment-reading">
                  <div className="environment-symbol humidity-symbol">%</div>
                  <div>
                    <p className="reading-label">Humidity</p>
                    <p className="reading-value">
                      {reading.humidity_pct == null
                        ? '—'
                        : `${Number(reading.humidity_pct).toFixed(1)}%`}
                    </p>
                  </div>
                </div>

                <div className="reading-timestamp">
                  Last recorded: {fmtDate(reading.recorded_at)}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h3>No sensor readings yet</h3>
                <p>New readings will appear here when available.</p>
              </div>
            )}
          </div>
        </section>

        <section id="inventory" className="dashboard-section">
          {!roleLoading && !roleError && admin && (
            <div className="admin-inventory-panel">
              <div className="section-heading">
                <div>
                  <h2>Manage inventory</h2>
                  <p>Add products and record incoming stock.</p>
                </div>
                <Badge status="Admin only" />
              </div>

              {actionError && (
                <div className="notice error-notice" role="alert">
                  {actionError}
                </div>
              )}

              {success && (
                <div className="notice success-notice" role="status">
                  {success}
                </div>
              )}

              <div className="inventory-forms">
                <form className="inventory-form" onSubmit={addProduct}>
                  <h3>Add a product</h3>

                  <label htmlFor="product-name">Product name</label>
                  <input
                    id="product-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    maxLength={150}
                    placeholder="e.g. Maize Meal"
                    required
                  />

                  <label htmlFor="product-sku">SKU (optional)</label>
                  <input
                    id="product-sku"
                    value={sku}
                    onChange={e => setSku(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. MM-001"
                  />

                  <div className="form-field-grid">
                    <div>
                      <label htmlFor="product-threshold">
                        Low-stock threshold
                      </label>
                      <input
                        id="product-threshold"
                        type="number"
                        min="0"
                        step="1"
                        value={threshold}
                        onChange={e => setThreshold(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="initial-stock">Initial stock</label>
                      <input
                        id="initial-stock"
                        type="number"
                        min="0"
                        step="1"
                        value={initialStock}
                        onChange={e => setInitialStock(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button className="primary-button" disabled={saving}>
                    {saving ? 'Saving…' : 'Add product'}
                  </button>
                </form>

                <form className="inventory-form" onSubmit={restock}>
                  <h3>Restock a product</h3>

                  <label htmlFor="restock-product">Select product</label>
                  <select
                    id="restock-product"
                    value={productId}
                    onChange={e => setProductId(e.target.value)}
                    required
                  >
                    <option value="">Choose a product</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — current stock: {p.current_stock}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="restock-quantity">Quantity to add</label>
                  <input
                    id="restock-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    required
                  />

                  <label htmlFor="restock-note">Note (optional)</label>
                  <input
                    id="restock-note"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    maxLength={500}
                    placeholder="e.g. New delivery"
                  />

                  <button
                    className="primary-button"
                    disabled={saving || products.length === 0}
                  >
                    {saving ? 'Saving…' : 'Add stock'}
                  </button>
                </form>
              </div>
            </div>
          )}

          <div className="section-heading">
            <div>
              <h2>Inventory</h2>
              <p>Active products and their current stock levels</p>
            </div>
            <span className="count-label">{products.length} products</span>
          </div>

          <div className="table-card">
            {products.length === 0 && !loading ? (
              <div className="empty-state">
                <h3>No active products found</h3>
                <p>Products will appear here once available.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Current stock</th>
                      <th>Low-stock threshold</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => {
                      const stock = Number(p.current_stock) || 0;
                      const limit = Number(p.low_stock_level) || 0;
                      const status = stock <= 0
                        ? 'Out of stock'
                        : stock <= limit
                          ? 'Low stock'
                          : 'In stock';

                      return (
                        <tr key={p.id}>
                          <td>
                            <div className="product-name">{p.name}</div>
                          </td>
                          <td className="numeric-cell">{stock}</td>
                          <td className="numeric-cell">{limit}</td>
                          <td><Badge status={status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section id="alerts" className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Recent alerts</h2>
              <p>The latest 10 alerts recorded for this storeroom</p>
            </div>
            <span className="count-label">{alerts.length} alerts</span>
          </div>

          <div className="alerts-list">
            {alerts.length === 0 && !loading ? (
              <div className="empty-state">
                <h3>No alerts found</h3>
                <p>New alerts will appear here when generated.</p>
              </div>
            ) : (
              alerts.map(a => (
                <article className="alert-item" key={a.id}>
                  <div className="alert-indicator" />
                  <div className="alert-content">
                    <div className="alert-title-row">
                      <h3>{a.message || a.alert_type || 'Alert'}</h3>
                      <Badge status={a.severity} />
                    </div>
                    <p className="alert-meta">
                      {a.alert_type || 'General alert'} · {fmtDate(a.created_at)}
                    </p>
                  </div>
                  <Badge status={a.status} />
                </article>
              ))
            )}
          </div>
        </section>

        <footer className="page-footer">
          <span>Storeroom Management System</span>
          <span>
            {roleLoading
              ? 'Verifying access…'
              : roleError
                ? 'Access role unverified'
                : admin
                  ? 'Administrator access'
                  : 'Read-only viewer access'}
          </span>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;

      if (error) {
        console.error('Unable to retrieve session:', error.message);
      }

      setSession(data?.session || null);
      setAuthLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      window.alert(`Unable to sign out: ${error.message}`);
    }
  }

  if (authLoading) {
    return (
      <main className="loading-page">
        <div className="loading-spinner" />
        <p>Checking your session…</p>
      </main>
    );
  }

  if (!session) return <Login />;

  return (
    <Dashboard
      key={session.user.id}
      session={session}
      signOut={signOut}
    />
  );
}
