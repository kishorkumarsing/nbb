/*
  # Add automatic profile creation on user signup

  1. New Functions
    - `handle_new_user()` - Automatically creates a profile when a new user is created
  
  2. New Triggers
    - `on_auth_user_created` - Triggers profile creation on auth.users insert

  3. Security
    - Ensures every authenticated user has a corresponding profile
    - Prevents foreign key constraint violations
    - Uses system-generated default values for required fields

  4. Important Notes
    - This trigger runs on auth.users table when new users are created
    - Profiles are created with default values if not provided
    - The user ID is automatically linked from the auth.users table
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'full_name', new.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();