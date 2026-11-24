-- One-time fix: the Instinct login was created without email confirmation, which blocks sign-in.
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where lower(email) = 'michaellifschutz@mail.instinct.com';
