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
    const url = new URL(req.url);
    const accountNumber = url.searchParams.get('account_number');
    const userIdParam = url.searchParams.get('user_id');

    if (!accountNumber && !userIdParam) {
      return new Response(
        JSON.stringify({ error: 'Either account_number or user_id query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // AUTH
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;

    // Use admin client to fetch accounts
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    let query = supabaseAdmin
      .from('accounts')
      .select('id, user_id, account_number, account_type, balance, currency, status, created_at, updated_at');

    if (accountNumber) {
      query = query.eq('account_number', accountNumber);
    } else if (userIdParam) {
      query = query.eq('user_id', userIdParam);
    }

    const { data: account, error } = await query.maybeSingle();
    if (error) throw error;

    if (!account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent access to other users' accounts
    if (account.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized access to this account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // FETCH PROFILE
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, phone, date_of_birth, address, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) throw profileError;

    // FETCH ALL USER ACCOUNTS
    const { data: allAccounts, error: accountsError } = await supabaseAdmin
      .from('accounts')
      .select('account_number, account_type, balance, currency, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (accountsError) throw accountsError;

    // Calculate total balance
    const totalBalance = allAccounts?.reduce((sum, acc) => sum + parseFloat(acc.balance), 0) || 0;

    return new Response(
      JSON.stringify({
        profile,
        email: userData,
        account: {
          account_number: account.account_number,
          account_type: account.account_type,
          balance: account.balance,
          currency: account.currency,
          status: account.status,
          created_at: account.created_at,
          updated_at: account.updated_at,
        },
        all_accounts: allAccounts || [],
        total_balance: totalBalance,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
