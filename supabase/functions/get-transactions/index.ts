import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

    const url = new URL(req.url);
    const accountNumber = url.searchParams.get('account_number');
    const limit = url.searchParams.get('limit') || '50';

    if (!accountNumber) {
      return new Response(
        JSON.stringify({ error: 'Missing account_number parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get account by account_number and verify user owns it
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('account_number', accountNumber)
      .eq('user_id', user.id)
      .maybeSingle();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or unauthorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get transactions for the account
    const { data: transactions, error: transError } = await supabase
      .from('transactions')
      .select('id, type,account_number, amount, balance_after, description, reference_number, status, created_at')
      .eq('account_number', accountNumber)
      .order('created_at', { ascending: false });

    if (transError) {
      throw transError;
    }

    // Get transfers where account is sender or receiver
    const { data: transfers, error: transferError } = await supabase
      .from('transfers')
      .select('id, from_account_id, to_account_id, amount, reference_number, notes, status, completed_at, from_account:from_account_id(account_number), to_account:to_account_id(account_number)')
      .or(`from_account_id.eq.${account.id},to_account_id.eq.${account.id}`)
      .order('completed_at', { ascending: false });

    if (transferError) {
      throw transferError;
    }

    // Combine and sort all records by date
    const combinedRecords = [
      ...(transactions || []).map(t => ({
        id: t.id,
        type: 'transaction',
        transaction_type: t.type,
        amount: t.amount,
        account_number:t.account_number,
        balance_after: t.balance_after,
        description: t.description,
        reference_number: t.reference_number,
        status: t.status,
        created_at: t.created_at,
      })),
      ...(transfers || []).map(tr => ({
        id: tr.id,
        type: 'transfer',
        from_account_number: tr.from_account?.account_number,
        to_account_number: tr.to_account?.account_number,
        amount: tr.amount,
        notes: tr.notes,
        reference_number: tr.reference_number,
        status: tr.status,
        created_at: tr.completed_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
     .slice(0, parseInt(limit));

    return new Response(
      JSON.stringify({ transactions: combinedRecords }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
