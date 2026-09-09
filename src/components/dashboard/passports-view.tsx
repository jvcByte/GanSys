"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Shield, ShieldCheck, ShieldAlert, Clock, X, Check, AlertTriangle, Copy, ExternalLink, FileText } from "lucide-react";

import styles from "@/components/dashboard/passports.module.css";
import type { SessionUser, PassportProfileView, PassportOverview, RuleEvaluationResult, CertificateView } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { getSuggestedBand } from "@/lib/passport-suggestions";
import { useWs } from "@/lib/ws-context";

type Props = {
  user: SessionUser;
};

export function PassportsView({ user }: Props) {
  const [overview, setOverview] = useState<PassportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastMessage } = useWs();
  const [refreshNonce, setRefreshNonce] = useState(0);
  
  // Form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PassportProfileView | null>(null);
  const [issuingProfileId, setIssuingProfileId] = useState<string | null>(null);
  const [selectedCertificate, setSelectedCertificate] = useState<CertificateView | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/passports");
      if (!res.ok) throw new Error("Failed to load passports");
      const data = await res.json();
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load passports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Live refresh when device telemetry arrives over WebSocket
  useEffect(() => {
    if (lastMessage?.type !== "controller_update") return;
    setRefreshNonce((n) => n + 1);
    void fetchOverview();
  }, [lastMessage, fetchOverview]);

  const handleCreateProfile = async (data: ProfileFormData) => {
    try {
      const res = await fetch("/api/passports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create profile");
      }
      
      setShowCreateForm(false);
      await fetchOverview();
    } catch (err) {
      throw err;
    }
  };

  const handleUpdateProfile = async (profileId: string, data: Partial<ProfileFormData>) => {
    try {
      const res = await fetch(`/api/passports/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update profile");
      }
      
      setEditingProfile(null);
      await fetchOverview();
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm("Delete this profile? Certificates will be preserved.")) return;
    
    try {
      const res = await fetch(`/api/passports/${profileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete profile");
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete profile");
    }
  };

  const handleIssueCertificate = async (profileId: string) => {
    setIssuingProfileId(profileId);
    try {
      const res = await fetch(`/api/passports/${profileId}/issue`, { method: "POST" });
      const data = await res.json();
      
      if (!res.ok) {
        if (data.error === "PASSPORT_NOT_COMPLIANT") {
          alert(`Cannot issue: ${data.reasons?.map((r: { channelId: string; reason: string }) => r.reason).join(", ")}`);
        } else if (data.error === "PASSPORT_DISABLED") {
          alert("Cannot issue: Profile is disabled");
        } else {
          throw new Error(data.error || "Failed to issue certificate");
        }
        return;
      }
      
      await fetchOverview();
      setSelectedCertificate(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to issue certificate");
    } finally {
      setIssuingProfileId(null);
    }
  };

  const handleRevokeCertificate = async (certificateId: string) => {
    if (!confirm("Revoke this certificate? This cannot be undone.")) return;
    
    try {
      const res = await fetch(`/api/passports/certificates/${certificateId}?action=revoke`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to revoke certificate");
      setSelectedCertificate(null);
      await fetchOverview();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke certificate");
    }
  };

  const handleToggleEnabled = async (profileId: string, enabled: boolean) => {
    await handleUpdateProfile(profileId, { enabled });
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading passports...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Food Safety Passports</h1>
          <p className={styles.subtitle}>
            Manage compliance profiles and issue export certificates
          </p>
        </div>
        <button
          className={styles.createButton}
          onClick={() => setShowCreateForm(true)}
        >
          <Plus size={18} />
          Create Profile
        </button>
      </div>

      {overview && (
        <>
          {/* Profiles Section */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Compliance Profiles</h2>
            {overview.profiles.length === 0 ? (
              <div className={styles.empty}>
                <Shield size={48} strokeWidth={1} />
                <p>No profiles yet. Create your first compliance profile to start issuing certificates.</p>
              </div>
            ) : (
              <div className={styles.profilesGrid}>
                {overview.profiles.map((profile) => (
                  <ProfileCard
                    key={`${profile.id}-${refreshNonce}`}
                    profile={profile}
                    onEdit={() => setEditingProfile(profile)}
                    onDelete={() => handleDeleteProfile(profile.id)}
                    onToggleEnabled={(enabled) => handleToggleEnabled(profile.id, enabled)}
                    onIssue={() => handleIssueCertificate(profile.id)}
                    isIssuing={issuingProfileId === profile.id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Recent Certificates Section */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Certificates</h2>
            {overview.certificates.length === 0 ? (
              <div className={styles.emptySmall}>
                <p>No certificates issued yet.</p>
              </div>
            ) : (
              <div className={styles.certificatesList}>
                {overview.certificates.map((cert) => (
                  <button
                    key={cert.id}
                    className={styles.certificateItem}
                    onClick={async () => {
                      const res = await fetch(`/api/passports/certificates/${cert.id}`);
                      if (res.ok) {
                        setSelectedCertificate(await res.json());
                      }
                    }}
                  >
                    <div className={styles.certInfo}>
                      <span className={styles.certId}>{cert.id}</span>
                      <span className={styles.certProduct}>{cert.productName}</span>
                    </div>
                    <div className={styles.certMeta}>
                      <span className={cn(styles.statusBadge, cert.status === "valid" ? styles.statusValid : styles.statusRevoked)}>
                        {cert.status === "valid" ? "Valid" : "Revoked"}
                      </span>
                      <span className={styles.certDate}>
                        {new Date(cert.issuedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Create/Edit Profile Modal */}
      {(showCreateForm || editingProfile) && (
        <ProfileFormModal
          profile={editingProfile}
          user={user}
          onSubmit={editingProfile ? 
            (data) => handleUpdateProfile(editingProfile.id, data) : 
            handleCreateProfile
          }
          onClose={() => {
            setShowCreateForm(false);
            setEditingProfile(null);
          }}
        />
      )}

      {/* Certificate Detail Modal */}
      {selectedCertificate && (
        <CertificateModal
          certificate={selectedCertificate}
          onRevoke={() => handleRevokeCertificate(selectedCertificate.id)}
          onClose={() => setSelectedCertificate(null)}
        />
      )}
    </div>
  );
}

// ===========================================
// Profile Card Component
// ===========================================

type ProfileCardProps = {
  profile: PassportProfileView;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onIssue: () => void;
  isIssuing: boolean;
};

function ProfileCard({ profile, onEdit, onDelete, onToggleEnabled, onIssue, isIssuing }: ProfileCardProps) {
  const [compliance, setCompliance] = useState<Record<string, RuleEvaluationResult> | null>(null);
  
  useEffect(() => {
    async function fetchCompliance() {
      try {
        const res = await fetch(`/api/passports/${profile.id}`);
        if (res.ok) {
          const data = await res.json();
          setCompliance(data.compliance);
        }
      } catch {
        // Ignore compliance fetch errors
      }
    }
    fetchCompliance();
  }, [profile.id]);

  const overallStatus: "compliant" | "non_compliant" | "stale_data" | "no_data" = (() => {
    if (!compliance) return "no_data";
    const values = Object.values(compliance);
    if (values.length === 0) return "no_data";
    if (values.some((r) => r.status === "out_of_range")) return "non_compliant";
    if (values.some((r) => r.status === "stale_data")) return "stale_data";
    if (values.some((r) => r.status === "no_data")) return "no_data";
    return "compliant";
  })();

  const failingRules = compliance
    ? Object.values(compliance).filter((r) => r.status !== "pass")
    : [];

  return (
    <div className={cn(styles.profileCard, !profile.enabled && styles.profileCardDisabled)}>
      <div className={styles.profileHeader}>
        <div className={styles.profileTitleRow}>
          <h3 className={styles.profileName}>{profile.name}</h3>
          <span className={cn(
            styles.statusPill,
            overallStatus === "compliant" && styles.statusPillCompliant,
            overallStatus === "non_compliant" && styles.statusPillNonCompliant,
            (overallStatus === "stale_data" || overallStatus === "no_data") && styles.statusPillWarning
          )}>
            {overallStatus === "compliant" && "Compliant"}
            {overallStatus === "non_compliant" && "Non-Compliant"}
            {overallStatus === "stale_data" && "Stale Data"}
            {overallStatus === "no_data" && "No Data"}
          </span>
        </div>
        <p className={styles.profileProduct}>{profile.productName} → {profile.destination}</p>
        <div className={styles.profileMeta}>
          <span><Clock size={14} /> {profile.lookbackHours}h window</span>
          <span>Max age: {profile.maxDataAgeMinutes}m</span>
        </div>
      </div>

      {/* Rules Table */}
      <div className={styles.rulesTable}>
        <div className={styles.rulesHeader}>
          <span>Metric</span>
          <span>Allowed</span>
          <span>Latest</span>
          <span>Samples</span>
          <span>Status</span>
        </div>
        {profile.rules.map((rule) => {
          const ruleCompliance = compliance?.[rule.channelId];
          return (
            <div key={rule.id} className={styles.rulesRow}>
              <span className={styles.ruleMetric}>{rule.channelName}</span>
              <span className={styles.ruleAllowed}>
                {rule.minValue}–{rule.maxValue} {rule.unit}
              </span>
              <span className={styles.ruleLatest}>
                {ruleCompliance?.latest !== null && ruleCompliance?.latest !== undefined
                  ? ruleCompliance.latest.toFixed(1)
                  : "—"}
                {ruleCompliance?.latestObservedAt && (
                  <small className={styles.ruleMeta}>{formatRelativeTime(ruleCompliance.latestObservedAt)}</small>
                )}
              </span>
              <span className={styles.ruleSamples}>
                {ruleCompliance?.sampleCount ?? 0}
              </span>
              <span
                className={cn(
                  styles.ruleStatus,
                  ruleCompliance?.status === "pass" && styles.ruleStatusOk,
                  ruleCompliance?.status === "out_of_range" && styles.ruleStatusFail,
                  (ruleCompliance?.status === "stale_data" || ruleCompliance?.status === "no_data") && styles.ruleStatusWarn
                )}
                title={ruleCompliance?.reason ?? ""}
              >
                {ruleCompliance?.status === "pass" && <Check size={14} />}
                {ruleCompliance?.status === "out_of_range" && <X size={14} />}
                {(ruleCompliance?.status === "stale_data" || ruleCompliance?.status === "no_data") && <AlertTriangle size={14} />}
                {ruleCompliance && <small className={styles.ruleStatusText}>{ruleCompliance.status.replace("_", " ")}</small>}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.profileActions}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={profile.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          Enabled
        </label>
        <div className={styles.actionButtons}>
          <button className={styles.actionBtn} onClick={onEdit}>Edit</button>
          <button className={styles.actionBtn} onClick={onDelete}>Delete</button>
          <button
            className={cn(styles.issueBtn, (!profile.enabled || overallStatus !== "compliant") && styles.issueBtnDisabled)}
            onClick={onIssue}
            disabled={isIssuing || !profile.enabled || overallStatus !== "compliant"}
            title={
              !profile.enabled
                ? "Profile is disabled - enable it before issuing"
                : overallStatus !== "compliant"
                  ? failingRules.map((r) => r.reason).join(" | ")
                  : ""
            }
          >
            {isIssuing ? "Issuing..." : "Issue Certificate"}
          </button>
        </div>
        {profile.enabled && overallStatus !== "compliant" && failingRules.length > 0 && (
          <p className={styles.issueHint}>
            Cannot issue until all rules pass: {failingRules.slice(0, 3).map((r) => r.reason).join(" · ")}
            {failingRules.length > 3 ? " …" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ===========================================
// Profile Form Modal
// ===========================================

type ProfileFormData = {
  name: string;
  productName: string;
  destination: string;
  lookbackHours: number;
  maxDataAgeMinutes: number;
  enabled?: boolean;
  rules: Array<{
    channelId: string;
    minValue: number;
    maxValue: number;
  }>;
};

type ProfileFormModalProps = {
  profile: PassportProfileView | null;
  user: SessionUser;
  onSubmit: (data: ProfileFormData) => Promise<void>;
  onClose: () => void;
};

function ProfileFormModal({ profile, user, onSubmit, onClose }: ProfileFormModalProps) {
  const [form, setForm] = useState<ProfileFormData>({
    name: profile?.name ?? "",
    productName: profile?.productName ?? "",
    destination: profile?.destination ?? "",
    lookbackHours: profile?.lookbackHours ?? 168,
    maxDataAgeMinutes: profile?.maxDataAgeMinutes ?? 60,
    rules: profile?.rules.map(r => ({
      channelId: r.channelId,
      minValue: r.minValue,
      maxValue: r.maxValue,
    })) ?? [],
  });
  
  const [availableChannels, setAvailableChannels] = useState<Array<{
    id: string;
    name: string;
    template: string;
    unit: string;
    minValue: number;
    maxValue: number;
  }>>([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Array<{ channelId: string; result: RuleEvaluationResult }> | null>(null);

  useEffect(() => {
    // Fetch user's eligible channels
    async function fetchChannels() {
      try {
        const res = await fetch("/api/controllers");
        if (res.ok) {
          const data = await res.json();
          const allChannels: typeof availableChannels = [];
          for (const controller of data.controllers || []) {
            for (const channel of controller.channels || []) {
              // Filter to numeric sensors only
              if (channel.kind !== "actuator" && channel.unit !== "state" && channel.unit !== "image") {
                allChannels.push({
                  id: channel.id,
                  name: `${controller.name} / ${channel.name}`,
                  template: channel.template,
                  unit: channel.unit,
                  minValue: channel.minValue,
                  maxValue: channel.maxValue,
                });
              }
            }
          }
          setAvailableChannels(allChannels);
        }
      } catch {
        // Ignore
      }
    }
    fetchChannels();
  }, []);

  // Live compliance preview: re-evaluates the unsaved rule set server-side and
  // warns when the chosen bands would currently fail (never blocks saving).
  useEffect(() => {
    if (form.rules.length === 0) {
      setPreview(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/passports/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lookbackHours: form.lookbackHours,
            maxDataAgeMinutes: form.maxDataAgeMinutes,
            rules: form.rules,
          }),
        });
        if (!active || !res.ok) return;
        const data = (await res.json()) as { results: Array<{ channelId: string; result: RuleEvaluationResult }> };
        if (active) setPreview(data.results);
      } catch {
        // Transient error - keep the previous preview.
      }
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.lookbackHours, form.maxDataAgeMinutes, form.rules]);

  const handleAddRule = (channelId: string) => {
    const channel = availableChannels.find(c => c.id === channelId);
    if (!channel) return;

    // Check for duplicates
    if (form.rules.some(r => r.channelId === channelId)) return;

    // Prefill the suggested compliance band for known water-quality metrics,
    // otherwise fall back to the channel's full numeric range for manual entry.
    const suggested = getSuggestedBand(channel.template);
    const suggestedMin = suggested?.min ?? channel.minValue;
    const suggestedMax = suggested?.max ?? channel.maxValue;

    setForm(prev => ({
      ...prev,
      rules: [...prev.rules, {
        channelId,
        minValue: suggestedMin,
        maxValue: suggestedMax,
      }],
    }));
  };

  const handleRemoveRule = (channelId: string) => {
    setForm(prev => ({
      ...prev,
      rules: prev.rules.filter(r => r.channelId !== channelId),
    }));
  };

  const handleRuleChange = (channelId: string, field: "minValue" | "maxValue", value: number) => {
    setForm(prev => ({
      ...prev,
      rules: prev.rules.map(r => 
        r.channelId === channelId ? { ...r, [field]: value } : r
      ),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{profile ? "Edit Profile" : "Create Profile"}</h2>
          <button className={styles.modalClose} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalBody}>
          {error && <div className={styles.formError}>{error}</div>}
          
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>Profile Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Tomato Export to EU"
                required
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>Product Name</label>
              <input
                type="text"
                value={form.productName}
                onChange={e => setForm(prev => ({ ...prev, productName: e.target.value }))}
                placeholder="e.g., Organic Tomatoes"
                required
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>Destination</label>
              <input
                type="text"
                value={form.destination}
                onChange={e => setForm(prev => ({ ...prev, destination: e.target.value }))}
                placeholder="e.g., European Union"
                required
              />
            </div>
            
            <div className={styles.formGroup}>
              <label>Lookback Window (hours)</label>
              <input
                type="number"
                min={24}
                max={720}
                value={form.lookbackHours}
                onChange={e => setForm(prev => ({ ...prev, lookbackHours: parseInt(e.target.value) }))}
                required
              />
              <span className={styles.formHint}>24–720 hours</span>
            </div>
            
            <div className={styles.formGroup}>
              <label>Max Data Age (minutes)</label>
              <input
                type="number"
                min={5}
                max={1440}
                value={form.maxDataAgeMinutes}
                onChange={e => setForm(prev => ({ ...prev, maxDataAgeMinutes: parseInt(e.target.value) }))}
                required
              />
              <span className={styles.formHint}>5–1440 minutes</span>
            </div>
          </div>

          <div className={styles.rulesSection}>
            <label>Compliance Rules</label>
            <select
              className={styles.channelSelect}
              onChange={e => {
                handleAddRule(e.target.value);
                e.target.value = "";
              }}
              value=""
            >
              <option value="">Add a channel...</option>
              {availableChannels
                .filter(c => !form.rules.some(r => r.channelId === c.id))
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.unit})
                  </option>
                ))}
            </select>

            {form.rules.length > 0 && (
              <div className={styles.editRulesList}>
                {form.rules.map(rule => {
                  const channel = availableChannels.find(c => c.id === rule.channelId);
                  if (!channel) return null;
                  
                  return (
                    <div key={rule.channelId} className={styles.editRuleItem}>
                      <div className={styles.editRuleInfo}>
                        <span className={styles.editRuleName}>{channel.name}</span>
                        <span className={styles.editRuleUnit}>{channel.unit}</span>
                      </div>
                      {(() => {
                        const pv = preview?.find((p) => p.channelId === rule.channelId)?.result;
                        if (!pv) return null;
                        if (pv.status === "pass") {
                          return (
                            <span className={cn(styles.previewBadge, styles.previewOk)}>
                              <Check size={12} /> passing now
                            </span>
                          );
                        }
                        return (
                          <span className={cn(styles.previewBadge, styles.previewWarn)} title={pv.reason}>
                            <AlertTriangle size={12} /> {pv.status.replace("_", " ")}: {pv.reason}
                          </span>
                        );
                      })()}
                      <div className={styles.editRuleBounds}>
                        <input
                          type="number"
                          step="any"
                          value={rule.minValue}
                          onChange={e => handleRuleChange(rule.channelId, "minValue", parseFloat(e.target.value))}
                          placeholder="Min"
                        />
                        <span>–</span>
                        <input
                          type="number"
                          step="any"
                          value={rule.maxValue}
                          onChange={e => handleRuleChange(rule.channelId, "maxValue", parseFloat(e.target.value))}
                          placeholder="Max"
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.removeRuleBtn}
                        onClick={() => handleRemoveRule(rule.channelId)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {preview && preview.some((p) => p.result.status !== "pass") && (
            <p className={styles.previewWarning}>
              <AlertTriangle size={14} />
              Warning: {preview.filter((p) => p.result.status !== "pass").length} rule(s) currently fail against
              your selected bands. You can save this profile anyway, but certificates cannot be issued until every
              rule passes.
            </p>
          )}

          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn} disabled={loading || form.rules.length === 0}>
              {loading ? "Saving..." : profile ? "Update Profile" : "Create Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===========================================
// Certificate Modal
// ===========================================

type CertificateModalProps = {
  certificate: CertificateView;
  onRevoke: () => void;
  onClose: () => void;
};

function CertificateModal({ certificate, onRevoke, onClose }: CertificateModalProps) {
  const payload = JSON.parse(certificate.payloadJson);
  const verifyUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/verify/${certificate.id}`
    : `/verify/${certificate.id}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(verifyUrl);
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={cn(styles.modal, styles.certificateModal)} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>
            <ShieldCheck size={24} />
            Food Safety Passport
          </h2>
          <button className={styles.modalClose} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* Status */}
          <div className={cn(
            styles.certStatusBanner,
            certificate.verification.state === "VALID" && styles.certStatusValid,
            certificate.verification.state === "REVOKED" && styles.certStatusRevoked,
            certificate.verification.state === "TAMPERED" && styles.certStatusTampered
          )}>
            {certificate.verification.state === "VALID" && (
              <>
                <ShieldCheck size={32} />
                <span>VALID CERTIFICATE</span>
              </>
            )}
            {certificate.verification.state === "REVOKED" && (
              <>
                <ShieldAlert size={32} />
                <span>REVOKED</span>
              </>
            )}
            {certificate.verification.state === "TAMPERED" && (
              <>
                <AlertTriangle size={32} />
                <span>TAMPERED - DO NOT TRUST</span>
              </>
            )}
          </div>

          {/* Certificate Info */}
          <div className={styles.certDetails}>
            <div className={styles.certDetailRow}>
              <label>Certificate ID</label>
              <span>{certificate.id}</span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Product</label>
              <span>{certificate.productName}</span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Destination</label>
              <span>{certificate.destination}</span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Issuer</label>
              <span>{certificate.issuerName}</span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Farm</label>
              <span>{certificate.farmName}, {certificate.farmLocation}</span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Window</label>
              <span>
                {new Date(certificate.windowStart).toLocaleDateString()} – 
                {new Date(certificate.windowEnd).toLocaleDateString()}
              </span>
            </div>
            <div className={styles.certDetailRow}>
              <label>Issued</label>
              <span>{new Date(certificate.issuedAt).toLocaleString()}</span>
            </div>
          </div>

          {/* Evidence Table */}
          <div className={styles.evidenceSection}>
            <h3>Compliance Evidence</h3>
            <div className={styles.evidenceTable}>
              <div className={styles.evidenceHeader}>
                <span>Parameter</span>
                <span>Allowed Range</span>
                <span>Observed</span>
                <span>Samples</span>
                <span>Result</span>
              </div>
              {payload.evidence?.map((ev: {
                channelName: string;
                unit: string;
                allowedMin: number;
                allowedMax: number;
                observed: { min: number | null; max: number | null; avg: number | null; sampleCount: number };
                result: string;
              }, idx: number) => (
                <div key={idx} className={styles.evidenceRow}>
                  <span>{ev.channelName}</span>
                  <span>{ev.allowedMin}–{ev.allowedMax} {ev.unit}</span>
                  <span>
                    {ev.observed.min?.toFixed(1) ?? "—"} – {ev.observed.max?.toFixed(1) ?? "—"}
                    <br />
                    <small>avg: {ev.observed.avg?.toFixed(1) ?? "—"}</small>
                  </span>
                  <span>{ev.observed.sampleCount}</span>
                  <span className={cn(
                    ev.result === "pass" ? styles.evidenceOk : styles.evidenceFail
                  )}>
                    {ev.result === "pass" ? "PASS" : "FAIL"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Integrity Info */}
          <div className={styles.integritySection}>
            <h3>Integrity</h3>
            <div className={styles.integrityInfo}>
              <span>Version: {certificate.certificateVersion}</span>
              <span>Algorithm: {certificate.signatureAlgo}</span>
              <span>Key ID: {certificate.signatureKeyId}</span>
              <span className={styles.fingerprint}>
                Fingerprint: {certificate.payloadHash.slice(0, 16)}...
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className={styles.certActions}>
            <button className={styles.copyLinkBtn} onClick={handleCopyLink}>
              <Copy size={16} />
              Copy Verification Link
            </button>
            <a 
              href={verifyUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className={styles.viewPublicBtn}
            >
              <ExternalLink size={16} />
              View Public Page
            </a>
            {certificate.status === "valid" && (
              <button className={styles.revokeBtn} onClick={onRevoke}>
                Revoke Certificate
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
