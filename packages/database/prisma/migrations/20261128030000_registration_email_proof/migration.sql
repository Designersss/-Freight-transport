CREATE TABLE registration_email_proofs (
    token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    email TEXT NOT NULL CHECK (email = lower(email) AND email NOT LIKE '%.invalid'),
    expires_at TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX registration_email_proofs_expiry_idx
    ON registration_email_proofs (expires_at);

-- Invoked in the future credential creation transaction, never as a public
-- proof-only endpoint. If account creation rolls back, consumption does too.
CREATE FUNCTION consume_registration_email_proof(proof_hash TEXT, proof_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
    expiry TIMESTAMPTZ;
BEGIN
    SELECT expires_at INTO expiry
      FROM registration_email_proofs
      WHERE token_hash = proof_hash AND email = proof_email
      FOR UPDATE;
    IF NOT FOUND OR expiry <= clock_timestamp() THEN
        RETURN FALSE;
    END IF;
    DELETE FROM registration_email_proofs WHERE token_hash = proof_hash;
    RETURN FOUND;
END;
$$;
