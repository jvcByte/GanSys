"use client";

import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, HelpCircle, Printer } from "lucide-react";
import styles from "./verify.module.css";

type VerificationState = "VALID" | "REVOKED" | "TAMPERED" | "NOT_FOUND" | "VERIFICATION_UNAVAILABLE";

type EvidenceItem = {
  channelId: string;
  channelName: string;
  parameter: string;
  unit: string;
  allowedMin: number;
  allowedMax: number;
  observed: {
    min: number | null;
    max: number | null;
    avg: number | null;
    latest: number | null;
    sampleCount: number;
    latestObservedAt: string | null;
  };
  result: string;
  reason: string;
};

type CertificateView = {
  id: string;
  productName: string;
  destination: string;
  issuerName: string;
  farmName: string;
  farmLocation: string;
  windowStart: string;
  windowEnd: string;
  issuedAt: string;
  revokedAt: string | null;
  certificateVersion: number;
  signatureAlgo: string;
  signatureKeyId: string;
  payloadHash: string;
  evidence: EvidenceItem[];
};

type Props = {
  state: VerificationState;
  certificate: CertificateView | null;
  qrDataUrl: string | null;
};

export function VerifyPageClient({ state, certificate, qrDataUrl }: Props) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.logo}>
            <ShieldCheck size={32} />
            <span>Food Safety Passport</span>
          </div>
          <button className={styles.printBtn} onClick={handlePrint}>
            <Printer size={18} />
            Print
          </button>
        </header>

        {/* Status Banner */}
        <StatusBanner state={state} />

        {certificate && state !== "NOT_FOUND" && (
          <>
            {/* Certificate Info */}
            <section className={styles.section}>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <label>Certificate ID</label>
                  <span className={styles.mono}>{certificate.id}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Product</label>
                  <span>{certificate.productName}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Destination</label>
                  <span>{certificate.destination}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Issuer</label>
                  <span>{certificate.issuerName}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Farm</label>
                  <span>{certificate.farmName}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Location</label>
                  <span>{certificate.farmLocation}</span>
                </div>
                <div className={styles.infoItem}>
                  <label>Compliance Window</label>
                  <span>
                    {formatDate(certificate.windowStart)} – {formatDate(certificate.windowEnd)}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <label>Issued</label>
                  <span>{formatDateTime(certificate.issuedAt)}</span>
                </div>
                {certificate.revokedAt && (
                  <div className={styles.infoItem}>
                    <label>Revoked</label>
                    <span className={styles.revoked}>{formatDateTime(certificate.revokedAt)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* QR Code */}
            {qrDataUrl && (
              <section className={styles.qrSection}>
                <img src={qrDataUrl} alt="Certificate QR Code" className={styles.qrCode} />
                <p className={styles.qrHint}>Scan to verify online</p>
              </section>
            )}

            {/* Evidence Table */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Compliance Evidence</h2>
              <div className={styles.evidenceTable}>
                <div className={styles.evidenceHeader}>
                  <span>Parameter</span>
                  <span>Allowed Range</span>
                  <span>Observed</span>
                  <span>Samples</span>
                  <span>Result</span>
                </div>
                {certificate.evidence.map((ev, idx) => (
                  <div key={idx} className={styles.evidenceRow}>
                    <span className={styles.paramName}>
                      {ev.channelName}
                      <small>{ev.unit}</small>
                    </span>
                    <span className={styles.allowedRange}>
                      {ev.allowedMin} – {ev.allowedMax}
                    </span>
                    <span className={styles.observed}>
                      {ev.observed.min?.toFixed(1) ?? "—"} – {ev.observed.max?.toFixed(1) ?? "—"}
                      <small>avg: {ev.observed.avg?.toFixed(1) ?? "—"}</small>
                    </span>
                    <span className={styles.samples}>{ev.observed.sampleCount}</span>
                    <span className={ev.result === "pass" ? styles.pass : styles.fail}>
                      {ev.result === "pass" ? "PASS" : "FAIL"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Integrity Block */}
            <section className={styles.integritySection}>
              <h2 className={styles.sectionTitle}>Integrity</h2>
              <div className={styles.integrityGrid}>
                <div className={styles.integrityItem}>
                  <label>Certificate Version</label>
                  <span>{certificate.certificateVersion}</span>
                </div>
                <div className={styles.integrityItem}>
                  <label>Signature Algorithm</label>
                  <span>{certificate.signatureAlgo}</span>
                </div>
                <div className={styles.integrityItem}>
                  <label>Key ID</label>
                  <span>{certificate.signatureKeyId}</span>
                </div>
                <div className={styles.integrityItem}>
                  <label>Fingerprint</label>
                  <span className={styles.mono}>{certificate.payloadHash.slice(0, 16)}...</span>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Footer */}
        <footer className={styles.footer}>
          <p>Powered by GanSystems Food Safety Passport</p>
        </footer>
      </div>
    </div>
  );
}

function StatusBanner({ state }: { state: VerificationState }) {
  switch (state) {
    case "VALID":
      return (
        <div className={`${styles.statusBanner} ${styles.valid}`}>
          <ShieldCheck size={48} />
          <div>
            <h1>VALID CERTIFICATE</h1>
            <p>This certificate is authentic and has not been revoked.</p>
          </div>
        </div>
      );
    case "REVOKED":
      return (
        <div className={`${styles.statusBanner} ${styles.revoked}`}>
          <ShieldX size={48} />
          <div>
            <h1>REVOKED</h1>
            <p>This certificate has been revoked and is no longer valid.</p>
          </div>
        </div>
      );
    case "TAMPERED":
      return (
        <div className={`${styles.statusBanner} ${styles.tampered}`}>
          <AlertTriangle size={48} />
          <div>
            <h1>TAMPERED – DO NOT TRUST</h1>
            <p>The certificate data has been modified and cannot be trusted.</p>
          </div>
        </div>
      );
    case "NOT_FOUND":
      return (
        <div className={`${styles.statusBanner} ${styles.notFound}`}>
          <HelpCircle size={48} />
          <div>
            <h1>NOT FOUND</h1>
            <p>No certificate exists with this ID.</p>
          </div>
        </div>
      );
    case "VERIFICATION_UNAVAILABLE":
      return (
        <div className={`${styles.statusBanner} ${styles.unavailable}`}>
          <ShieldAlert size={48} />
          <div>
            <h1>VERIFICATION UNAVAILABLE</h1>
            <p>Signature verification is temporarily unavailable. Please try again later.</p>
          </div>
        </div>
      );
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
