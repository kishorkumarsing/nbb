import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface CreateAccountRequest {
  account_type: 'Current' | 'Savings' | 'Credit';
  initial_deposit?: number;
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

    const { account_type, initial_deposit = 0 }: CreateAccountRequest = await req.json();

    if (!['Current', 'Savings', 'Credit'].includes(account_type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid account type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate account number
    const { data: accountNumber, error: genError } = await supabase
      .rpc('generate_account_number');

    if (genError) {
      throw genError;
    }

    // Create account
    const currency ="BHD"
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .insert({
        user_id: user.id,
        account_number: accountNumber,
        account_type,
        balance: initial_deposit,
        currency,
        status: 'active',
      })
      .select()
      .single();

    if (accountError) {
      throw accountError;
    }

    // If initial deposit, create transaction
    if (initial_deposit > 0) {
      const { data: refNumber } = await supabase.rpc('generate_reference_number');

      await supabase.from('transactions').insert({
        account_id: account.id,
        type: 'deposit',
        amount: initial_deposit,
        balance_after: initial_deposit,
        description: 'Initial deposit',
        reference_number: refNumber,
        status: 'completed',
      });
    }

    return new Response(
      JSON.stringify({ account }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});