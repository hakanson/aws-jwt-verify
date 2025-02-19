// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Web implementations for the node-web-compatibility layer

import { SignatureJwk } from "jwk.js";
import {
  FetchError,
  NotSupportedError,
  JwtInvalidSignatureAlgorithmError,
  NonRetryableFetchError,
} from "./error.js";
import { NodeWebCompat } from "./node-web-compat.js";

/**
 * Enum to map supported JWT signature algorithms with WebCrypto curve names
 */
enum NamedCurvesWebCrypto {
  ES256 = "P-256",
  ES384 = "P-384",
  ES512 = "P-521", // yes, 521
}

interface CryptoKeyWithJwk {
  key: CryptoKey;
  jwk: SignatureJwk;
}

export const nodeWebCompat: NodeWebCompat = {
  fetch: async (
    uri: string,
    requestOptions?: Record<string, unknown>,
    data?: ArrayBuffer
  ) => {
    const responseTimeout = Number(requestOptions?.["responseTimeout"]);
    if (responseTimeout) {
      const abort = new AbortController();
      setTimeout(
        () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (abort.abort as any)(
            new FetchError(
              uri,
              `Response time-out (after ${responseTimeout} ms.)`
            )
          ),
        responseTimeout
      );
      requestOptions = { signal: abort.signal, ...requestOptions };
    }
    const response = await fetch(uri, { ...requestOptions, body: data }).catch(
      (err) => {
        throw new FetchError(uri, err.message);
      }
    );
    if (response.status !== 200) {
      throw new NonRetryableFetchError(
        uri,
        `Status code is ${response.status}, expected 200`
      );
    }
    return response.arrayBuffer();
  },
  defaultFetchTimeouts: {
    response: 3000,
  },
  transformJwkToKeyObjectSync: () => {
    throw new NotSupportedError(
      "Synchronously transforming a JWK into a key object is not supported in the browser"
    );
  },
  transformJwkToKeyObjectAsync: (jwk, jwtHeaderAlg) => {
    const alg = (jwk.alg as typeof jwtHeaderAlg) ?? jwtHeaderAlg;
    if (!alg) {
      throw new JwtInvalidSignatureAlgorithmError(
        "Missing alg on both JWK and JWT header",
        alg
      );
    }
    const algIdentifier = alg.startsWith("RS")
      ? {
          name: "RSASSA-PKCS1-v1_5",
          hash: `SHA-${alg.slice(2)}`,
        }
      : alg.startsWith("ES")
        ? {
            name: "ECDSA",

            namedCurve:
              NamedCurvesWebCrypto[alg as keyof typeof NamedCurvesWebCrypto],
          }
        : jwk.crv!; // Ed25519 or Ed448
    return crypto.subtle
      .importKey("jwk", jwk, algIdentifier, false, ["verify"])
      .then((key) => ({ key, jwk }));
  },
  verifySignatureSync: () => {
    throw new NotSupportedError(
      "Synchronously verifying a JWT signature is not supported in the browser"
    );
  },
  verifySignatureAsync: ({ jwsSigningInput, keyObject, signature, alg }) =>
    crypto.subtle.verify(
      alg.startsWith("RS")
        ? {
            name: "RSASSA-PKCS1-v1_5",
          }
        : alg.startsWith("ES")
          ? {
              name: "ECDSA",
              hash: `SHA-${alg.slice(2)}`,
            }
          : { name: (keyObject as CryptoKeyWithJwk).jwk.crv! },
      (keyObject as CryptoKeyWithJwk).key,
      bufferFromBase64url(signature),
      new TextEncoder().encode(jwsSigningInput)
    ),
  parseB64UrlString: (b64: string): string =>
    new TextDecoder().decode(bufferFromBase64url(b64)),
  setTimeoutUnref: setTimeout.bind(undefined),
};

const bufferFromBase64url = (function () {
  const map = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    .split("")
    .reduce(
      (acc, char, index) => Object.assign(acc, { [char.charCodeAt(0)]: index }),
      {} as { [key: number]: number }
    );
  return function (base64url: string) {
    base64url = base64url.replace(/={1,2}$/, ""); // ignore padding (e.g. AWS ALB)
    let first: number, second: number, third: number, fourth: number;
    return base64url.match(/.{1,4}/g)!.reduce(
      (acc, chunk, index) => {
        first = map[chunk.charCodeAt(0)];
        second = map[chunk.charCodeAt(1)];
        third = map[chunk.charCodeAt(2)];
        fourth = map[chunk.charCodeAt(3)];
        acc[3 * index] = (first << 2) | (second >> 4);
        acc[3 * index + 1] = ((second & 0b1111) << 4) | (third >> 2);
        acc[3 * index + 2] = ((third & 0b11) << 6) | fourth;
        return acc;
      },
      new Uint8Array((base64url.length * 3) / 4)
    );
  };
})();
