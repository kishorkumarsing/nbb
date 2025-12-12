/*
  ================================================
  BANKING APP SCHEMA (ACCOUNT_NUMBER–BASED MODEL)
  ================================================
*/

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  date_of_birth date,
  address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);



/* ===========================
   ACCOUNTS TABLE
   =========================== */
CREATE TABLE IF NOT EXISTS accounts (
  account_number text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_type text NOT NULL CHECK (account_type IN ('Current', 'Savings', 'Credit')),
  balance numeric(15,2) DEFAULT 0.00,
  currency text DEFAULT 'BHD',
  status text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own accounts"
  ON accounts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());



/* ===========================
   TRANSACTIONS TABLE
   =========================== */
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number text NOT NULL REFERENCES accounts(account_number) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  balance_after numeric(15,2) NOT NULL,
  description text,
  reference_number text UNIQUE NOT NULL,
  status text DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (
    account_number IN (
      SELECT account_number FROM accounts WHERE user_id = auth.uid()
    )
  );



/* ===========================
   TRANSFERS TABLE
   =========================== */
CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_number text NOT NULL REFERENCES accounts(account_number) ON DELETE CASCADE,
  to_account_number text NOT NULL REFERENCES accounts(account_number) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  reference_number text UNIQUE NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT different_accounts CHECK (from_account_number <> to_account_number)
);

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transfers"
  ON transfers FOR SELECT
  TO authenticated
  USING (
    from_account_number IN (SELECT account_number FROM accounts WHERE user_id = auth.uid()) OR
    to_account_number IN (SELECT account_number FROM accounts WHERE user_id = auth.uid())
  );



/* ===========================
   INDEXES (fixed)
   =========================== */
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_number ON accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_transactions_account_number ON transactions(account_number);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_account_number);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_account_number);



/* ===========================
   FUNCTIONS
   =========================== */

-- Generate unique account number
CREATE OR REPLACE FUNCTION generate_account_number()
RETURNS text AS $$
DECLARE
  new_number text;
  exists boolean;
BEGIN
  LOOP
    new_number := LPAD(FLOOR(RANDOM() * 10000000000)::text, 10, '0');
    SELECT EXISTS(SELECT 1 FROM accounts WHERE account_number = new_number) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Generate unique bank reference ID
CREATE OR REPLACE FUNCTION generate_reference_number()
RETURNS text AS $$
BEGIN
  RETURN 'REF' || TO_CHAR(NOW(), 'YYYYMMDD') || LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
END;
$$ LANGUAGE plpgsql;



/* ===========================
   TRIGGERS
   =========================== */
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
