import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface TransactionRequest {
  account_number: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  description?: string;
  reference_number?: string;
}

interface TransferRequest {
  type: 'transfer';
  from_account_number: string;
  to_account_number: string;
  amount: number;
  notes?: string;
}

type RequestBody = TransactionRequest | TransferRequest;

Deno.serve(async (req: Request) => {
  console.log("== Incoming Request ==");
  console.log("Method:", req.method);
  console.log("Headers:", Object.fromEntries(req.headers));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    console.log("Auth Header:", authHeader);

    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    console.log("Parsed Token:", token);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    console.log("Auth Result:", { user, authError });

    if (authError || !user) {
      console.error("Auth failed:", authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();
    console.log("Request Body:", body);

    if (body.type === 'transfer') {
      return handleTransfer(supabase, user.id, body as TransferRequest);
    }

    return handleTransaction(supabase, user.id, body as TransactionRequest);

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/* ---------------------------------------------------
   NORMAL TRANSACTION HANDLER
----------------------------------------------------*/

async function handleTransaction(
  supabase,
  userId,
  req
) {
  console.log("== HANDLE TRANSACTION ==");
  const { account_number, type, amount, description, reference_number } = req;

  if (amount <= 0) {
    return new Response(JSON.stringify({ error: 'Amount must be > 0' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Get account
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("account_number", account_number)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (accountError || !account) {
    return new Response(JSON.stringify({ error: "Account not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Withdrawal check
  if (type === "withdrawal" && account.balance < amount) {
    return new Response(JSON.stringify({ error: "Insufficient funds" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Calculate new balance
  const amountChange = type === "deposit" ? amount : -amount;
  const newBalance = parseFloat(account.balance) + amountChange;

  // Update balance
  const { error: updateError } = await supabase
    .from("accounts")
    .update({ balance: newBalance })
    .eq("account_number", account.account_number);

  if (updateError) throw updateError;

  // Insert transaction (amount always positive)
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .insert({
      account_number,
      type,
      amount, // ALWAYS POSITIVE
      balance_after: newBalance,
      description: description || type.toUpperCase(),
      reference_number: reference_number || null,
      status: "completed",
    })
    .select()
    .maybeSingle();

  console.log("Transaction Insert Result:", { transaction, transactionError });

  if (transactionError) throw transactionError;

  return new Response(JSON.stringify({ transaction }), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}



/* ---------------------------------------------------
   TRANSFER HANDLER
----------------------------------------------------*/

async function handleTransfer(supabase, userId, req) {
  console.log("== HANDLE TRANSFER ==");
  const { from_account_number, to_account_number, amount, notes } = req;

  if (amount <= 0) {
    return new Response(JSON.stringify({ error: "Amount must be > 0" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // FROM account
  const { data: fromAccount } = await supabase
    .from("accounts")
    .select("*")
    .eq("account_number", from_account_number)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!fromAccount) {
    return new Response(JSON.stringify({ error: "Source account not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (fromAccount.balance < amount) {
    return new Response(JSON.stringify({ error: "Insufficient funds" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // TO account
  const { data: toAccount } = await supabase
    .from("accounts")
    .select("*")
    .eq("account_number", to_account_number)
    .eq("status", "active")
    .maybeSingle();

  if (!toAccount) {
    return new Response(JSON.stringify({ error: "Destination not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get reference number
  const { data: refGen } = await supabase.rpc("generate_reference_number");
  const reference_number = refGen;

  // New balances
  const newFromBalance = parseFloat(fromAccount.balance) - amount;
  const newToBalance = parseFloat(toAccount.balance) + amount;

  // Update accounts
  await supabase.from("accounts").update({ balance: newFromBalance }).eq("id", fromAccount.id);
  await supabase.from("accounts").update({ balance: newToBalance }).eq("id", toAccount.id);

  // Insert transfer record
  const { data: transfer } = await supabase
    .from("transfers")
    .insert({
      from_account_id: fromAccount.id,
      to_account_id: toAccount.id,
      amount,
      reference_number,
      notes,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  // Transaction logs (NO NEGATIVE AMOUNT)
  await supabase.from("transactions").insert([
    {
      account_number: fromAccount.account_number,
      type: "transfer",
      amount,
      balance_after: newFromBalance,
      description: `Transfer to ${to_account_number}`,
      reference_number,
      status: "completed",
    },
    {
      account_number: toAccount.account_number,
      type: "transfer",
      amount,
      balance_after: newToBalance,
      description: `Transfer from ${from_account_number}`,
      reference_number,
      status: "completed",
    },
  ]);

  return new Response(JSON.stringify({ transfer, reference_number }), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

