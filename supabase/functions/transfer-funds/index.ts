import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface TransferRequest {
  from_account_id: string;
  to_account_number: string;
  amount: number;
  notes?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { from_account_id, to_account_number, amount, notes }: TransferRequest = await req.json();

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Amount must be greater than 0' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify from_account belongs to user
    const { data: fromAccount, error: fromError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', from_account_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (fromError || !fromAccount) {
      return new Response(
        JSON.stringify({ error: 'Source account not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check sufficient balance
    if (fromAccount.balance < amount) {
      return new Response(
        JSON.stringify({ error: 'Insufficient funds' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find destination account
    const { data: toAccount, error: toError } = await supabase
      .from('accounts')
      .select('*')
      .eq('account_number', to_account_number)
      .eq('status', 'active')
      .single();

    if (toError || !toAccount) {
      return new Response(
        JSON.stringify({ error: 'Destination account not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (fromAccount.id === toAccount.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot transfer to the same account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate reference number
    const { data: refNumber } = await supabase.rpc('generate_reference_number');

    // Update balances
    const newFromBalance = parseFloat(fromAccount.balance) - amount;
    const newToBalance = parseFloat(toAccount.balance) + amount;

    const { error: updateFromError } = await supabase
      .from('accounts')
      .update({ balance: newFromBalance })
      .eq('id', fromAccount.id);

    if (updateFromError) {
      throw updateFromError;
    }

    const { error: updateToError } = await supabase
      .from('accounts')
      .update({ balance: newToBalance })
      .eq('id', toAccount.id);

    if (updateToError) {
      // Rollback from account
      await supabase
        .from('accounts')
        .update({ balance: fromAccount.balance })
        .eq('id', fromAccount.id);
      throw updateToError;
    }

    // Create transfer record
    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .insert({
        from_account_id: fromAccount.id,
        to_account_id: toAccount.id,
        amount,
        reference_number: refNumber,
        notes,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (transferError) {
      throw transferError;
    }

    // Create transaction records
    await supabase.from('transactions').insert([
      {
        account_id: fromAccount.id,
        type: 'transfer',
        amount: -amount,
        balance_after: newFromBalance,
        description: `Transfer to ${to_account_number}`,
        reference_number: refNumber,
        status: 'completed',
      },
      {
        account_id: toAccount.id,
        type: 'transfer',
        amount: amount,
        balance_after: newToBalance,
        description: `Transfer from ${fromAccount.account_number}`,
        reference_number: refNumber,
        status: 'completed',
      },
    ]);

    return new Response(
      JSON.stringify({ transfer, reference_number: refNumber }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});