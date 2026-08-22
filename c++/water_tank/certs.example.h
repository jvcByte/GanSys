// -----------------------------------------------------------------------------
//  TLS CA certificate for the API host — DO NOT COMMIT.
//  Copy this file to `certs.h` in the same folder and paste the full
//  PEM-encoded CA certificate that signs the server certificate for the API
//  host used by SERVER_URL.
//
//  Obtain it, for example:
//    openssl s_client -connect gansystems.vercel.app:443 -showcerts </dev/null \
//      | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p'
//
//  The sketch FAILS CLOSED: the HTTPS connection is rejected unless the
//  certificate verifies (there is no setInsecure() fallback).
// -----------------------------------------------------------------------------
#ifndef GANSYS_CERTS_H
#define GANSYS_CERTS_H

// Root CA certificate for the API server (PEM format, may be multi-line)
const char* CA_CERT =
    "-----BEGIN CERTIFICATE-----\n"
    "REPLACE_WITH_YOUR_CA_CERTIFICATE\n"
    "-----END CERTIFICATE-----\n";

#endif // GANSYS_CERTS_H