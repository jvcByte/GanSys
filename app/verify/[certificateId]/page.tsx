import QRCode from "qrcode";

import { db } from "@/lib/db/client";
import { passportCertificates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPayload, verifyPayload, computeVerificationState, type VerificationState } from "@/lib/passport-policy";
import { VerifyPageClient } from "./client";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ certificateId: string }>;
};

export default async function VerifyPage({ params }: Props) {
  const { certificateId } = await params;

  // Fetch certificate
  const certRows = await db
    .select()
    .from(passportCertificates)
    .where(eq(passportCertificates.id, certificateId));

  const cert = certRows[0];

  if (!cert) {
    return (
      <VerifyPageClient
        state="NOT_FOUND"
        certificate={null}
        qrDataUrl={null}
      />
    );
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(cert.payloadJson);
  } catch {
    return (
      <VerifyPageClient
        state="TAMPERED"
        certificate={null}
        qrDataUrl={null}
      />
    );
  }

  // Verify hash
  const expectedHash = hashPayload(payload);
  const hashValid = expectedHash === cert.payloadHash;

  // Verify signature
  const signingSecret = process.env.PASSPORT_SIGNING_SECRET;
  let signatureValid = false;
  if (signingSecret) {
    try {
      signatureValid = verifyPayload(payload, signingSecret, cert.signature);
    } catch {
      signatureValid = false;
    }
  }

  // Compute verification state
  const state: VerificationState = computeVerificationState({
    found: true,
    revoked: cert.status === "revoked",
    hashValid,
    signatureValid,
    hasSecret: !!signingSecret,
  });

  // Build public URL for QR
  const publicUrl = process.env.PASSPORT_PUBLIC_URL || 
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  
  let qrDataUrl: string | null = null;
  if (publicUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(`${publicUrl}/verify/${cert.id}`, {
        width: 200,
        margin: 2,
        color: {
          dark: "#1a1a1a",
          light: "#ffffff",
        },
      });
    } catch {
      // QR generation failed, continue without it
    }
  }

  // Build certificate view (public data only)
  const certificateView = {
    id: cert.id,
    productName: cert.productName,
    destination: cert.destination,
    issuerName: cert.issuerName,
    farmName: cert.farmName,
    farmLocation: cert.farmLocation,
    windowStart: cert.windowStart instanceof Date ? cert.windowStart.toISOString() : String(cert.windowStart),
    windowEnd: cert.windowEnd instanceof Date ? cert.windowEnd.toISOString() : String(cert.windowEnd),
    issuedAt: cert.issuedAt instanceof Date ? cert.issuedAt.toISOString() : String(cert.issuedAt),
    revokedAt: cert.revokedAt ? (cert.revokedAt instanceof Date ? cert.revokedAt.toISOString() : String(cert.revokedAt)) : null,
    certificateVersion: cert.certificateVersion,
    signatureAlgo: cert.signatureAlgo,
    signatureKeyId: cert.signatureKeyId,
    payloadHash: cert.payloadHash,
    evidence: payload.evidence || [],
  };

  return (
    <VerifyPageClient
      state={state}
      certificate={certificateView}
      qrDataUrl={qrDataUrl}
    />
  );
}
