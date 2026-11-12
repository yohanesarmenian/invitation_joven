CREATE FUNCTION public.reception_name_key(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT lower(btrim(regexp_replace(normalize(value,NFKC),'[[:space:][:punct:]]+',' ','g')));
$$;
CREATE INDEX invitation_reception_name_key ON invitations(public.reception_name_key(display_name));
CREATE INDEX invitation_reception_greeting_key ON invitations(public.reception_name_key(coalesce(greeting_name,'')));
CREATE INDEX invitee_reception_name_key ON invitees(public.reception_name_key(full_name));
