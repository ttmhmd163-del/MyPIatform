-- MyPlatform Supabase schema
-- Compatible with the current local field names; this script does not connect to Supabase.

create extension if not exists pgcrypto;

-- Drop these views first so the legacy column names can be migrated safely.
drop view if exists public.public_services;
drop view if exists public.public_profiles;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null constraint profiles_name_length_check
        check (char_length(btrim(name)) between 1 and 90),
    email text,
    phone text constraint profiles_phone_length_check
        check (phone is null or char_length(phone) <= 25),
    preferences jsonb not null default
        '{"requestNotifications": false, "messageNotifications": false}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles (id) on delete cascade,
    name text not null constraint services_name_length_check
        check (char_length(btrim(name)) between 1 and 90),
    description text not null constraint services_description_length_check
        check (char_length(btrim(description)) between 1 and 1500),
    category text not null constraint services_category_check check (
        category in (
            'تصميم وإبداع',
            'برمجة وتقنية',
            'كتابة وترجمة',
            'تسويق وأعمال',
            'تعليم وتدريب',
            'خدمات أخرى'
        )
    ),
    price numeric(12, 2) not null constraint services_price_nonnegative_check
        check (price >= 0),
    status text not null default 'draft'
        constraint services_status_check
        check (status in ('draft', 'published', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.service_images (
    id uuid primary key default gen_random_uuid(),
    service_id uuid not null references public.services (id) on delete cascade,
    storage_path text not null unique,
    alt_text text,
    sort_order integer not null default 0
        constraint service_images_sort_order_check check (sort_order >= 0),
    created_at timestamptz not null default now()
);

-- Migrate column names used by the earlier version of this schema.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
    ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'name'
    ) then
        alter table public.profiles rename column full_name to name;
    end if;

    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'services' and column_name = 'title'
    ) and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'services' and column_name = 'name'
    ) then
        alter table public.services rename column title to name;
    end if;
end;
$$;

alter table public.profiles
    add column if not exists email text,
    add column if not exists phone text,
    add column if not exists preferences jsonb not null default
        '{"requestNotifications": false, "messageNotifications": false}'::jsonb,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

-- Add checks without rejecting legacy rows; new and changed rows are checked.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_name_length_check'
    ) then
        alter table public.profiles
            add constraint profiles_name_length_check
            check (char_length(btrim(name)) between 1 and 90) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_phone_length_check'
    ) then
        alter table public.profiles
            add constraint profiles_phone_length_check
            check (phone is null or char_length(phone) <= 25) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.services'::regclass
          and conname = 'services_name_length_check'
    ) then
        alter table public.services
            add constraint services_name_length_check
            check (char_length(btrim(name)) between 1 and 90) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.services'::regclass
          and conname = 'services_description_length_check'
    ) then
        alter table public.services
            add constraint services_description_length_check
            check (char_length(btrim(description)) between 1 and 1500) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.services'::regclass
          and conname = 'services_category_check'
    ) then
        alter table public.services
            add constraint services_category_check
            check (
                category in (
                    'تصميم وإبداع',
                    'برمجة وتقنية',
                    'كتابة وترجمة',
                    'تسويق وأعمال',
                    'تعليم وتدريب',
                    'خدمات أخرى'
                )
            ) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.services'::regclass
          and conname = 'services_price_nonnegative_check'
    ) then
        alter table public.services
            add constraint services_price_nonnegative_check
            check (price >= 0) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.services'::regclass
          and conname = 'services_status_check'
    ) then
        alter table public.services
            add constraint services_status_check
            check (status in ('draft', 'published', 'archived')) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.service_images'::regclass
          and conname = 'service_images_sort_order_check'
    ) then
        alter table public.service_images
            add constraint service_images_sort_order_check
            check (sort_order >= 0) not valid;
    end if;
end;
$$;

create index if not exists services_owner_id_idx on public.services (owner_id);
create index if not exists services_public_listing_idx
    on public.services (status, created_at desc);
create index if not exists services_public_category_idx
    on public.services (category, created_at desc)
    where status = 'published';
create index if not exists services_owner_created_idx
    on public.services (owner_id, created_at desc);
create index if not exists service_images_service_id_idx
    on public.service_images (service_id, sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
before update on public.services
for each row execute function public.set_updated_at();

-- Supabase Auth is the source of truth for the private login email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    profile_name text;
begin
    profile_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'مستخدم جديد'
    );

    insert into public.profiles (id, name, email, phone)
    values (
        new.id,
        left(profile_name, 90),
        new.email,
        case
            when char_length(coalesce(new.phone, new.raw_user_meta_data ->> 'phone', '')) <= 25
            then nullif(coalesce(new.phone, new.raw_user_meta_data ->> 'phone'), '')
            else null
        end
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.profiles
    set email = new.email
    where id = new.id;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_auth_user_email();

-- Backfill Auth accounts created before the profile trigger existed.
-- Existing profile rows and Auth rows are preserved; only missing profiles are added.
insert into public.profiles (id, name, email, phone)
select
    u.id,
    left(
        coalesce(
            nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
            nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
            'مستخدم جديد'
        ),
        90
    ),
    u.email,
    case
        when char_length(coalesce(u.phone, u.raw_user_meta_data ->> 'phone', '')) <= 25
        then nullif(coalesce(u.phone, u.raw_user_meta_data ->> 'phone'), '')
        else null
    end
from auth.users as u
where not exists (
    select 1
    from public.profiles as p
    where p.id = u.id
)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.service_images enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Anyone can read published services" on public.services;
create policy "Anyone can read published services"
on public.services for select
to anon, authenticated
using (status = 'published' or (select auth.uid()) = owner_id);

drop policy if exists "Users can create their own services" on public.services;
create policy "Users can create their own services"
on public.services for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their own services" on public.services;
create policy "Users can update their own services"
on public.services for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their own services" on public.services;
create policy "Users can delete their own services"
on public.services for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can read service images" on public.service_images;
create policy "Owners can read service images"
on public.service_images for select
to anon, authenticated
using (
    exists (
        select 1
        from public.services
        where services.id = service_images.service_id
          and (
              services.status = 'published'
              or services.owner_id = (select auth.uid())
          )
    )
);

drop policy if exists "Owners can add service images" on public.service_images;
create policy "Owners can add service images"
on public.service_images for insert
to authenticated
with check (
    exists (
        select 1
        from public.services
        where services.id = service_images.service_id
          and services.owner_id = (select auth.uid())
    )
);

drop policy if exists "Owners can update service images" on public.service_images;
create policy "Owners can update service images"
on public.service_images for update
to authenticated
using (
    exists (
        select 1
        from public.services
        where services.id = service_images.service_id
          and services.owner_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1
        from public.services
        where services.id = service_images.service_id
          and services.owner_id = (select auth.uid())
    )
);

drop policy if exists "Owners can delete service images" on public.service_images;
create policy "Owners can delete service images"
on public.service_images for delete
to authenticated
using (
    exists (
        select 1
        from public.services
        where services.id = service_images.service_id
          and services.owner_id = (select auth.uid())
    )
);

-- Views run with their owner's privileges, but expose only these explicit fields.
-- public_profiles includes only providers with at least one published service.
create view public.public_profiles
with (security_barrier = true, security_invoker = false)
as
select distinct p.id, p.name
from public.profiles as p
join public.services as s on s.owner_id = p.id
where s.status = 'published';

create view public.public_services
with (security_barrier = true, security_invoker = false)
as
select
    s.id,
    s.owner_id,
    s.name,
    s.description,
    s.category,
    s.price,
    s.created_at,
    p.name as provider_name
from public.services as s
join public.profiles as p on p.id = s.owner_id
where s.status = 'published';

-- Remove inherited/default access and grant only what each client role needs.
revoke all on table public.profiles, public.services, public.service_images
    from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, name, phone, preferences)
    on public.profiles to authenticated;
grant update (name, phone, preferences)
    on public.profiles to authenticated;
grant select on public.services to anon;
grant select, insert, update, delete on public.services to authenticated;
grant select on public.service_images to anon;
grant select, insert, update, delete on public.service_images to authenticated;

revoke all on public.public_profiles, public.public_services
    from public, anon, authenticated;
grant select on public.public_profiles, public.public_services
    to anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_auth_user_email() from public, anon, authenticated;

-- Private bucket: 3 MiB maximum and image types accepted by the project UI.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'service-images',
    'service-images',
    false,
    3145728,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Object names must be <user-uuid>/<service-uuid>/<filename>.<jpg|jpeg|png|webp>.
-- The bucket stays private; anonymous reads are allowed only for objects attached
-- to a published service. The restrictive rule also protects against other broad
-- permissive policies on storage.objects.
drop policy if exists "Restrict service image storage access" on storage.objects;
create policy "Restrict service image storage access"
on storage.objects as restrictive
for all
to public
using (
    bucket_id <> 'service-images'
    or (
        lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
        and (
            (
                auth.uid() is not null
                and (storage.foldername(name))[1] = (select auth.uid())::text
            )
            or exists (
                select 1
                from public.service_images as si
                join public.services as s on s.id = si.service_id
                where si.storage_path = storage.objects.name
                  and s.status = 'published'
            )
        )
    )
)
with check (
    bucket_id <> 'service-images'
    or (
        auth.uid() is not null
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1
            from public.services
            where services.id::text = (storage.foldername(name))[2]
              and services.owner_id = (select auth.uid())
        )
        and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    )
);

drop policy if exists "Owners can read their service image objects" on storage.objects;
drop policy if exists "Owners can upload their service image objects" on storage.objects;
drop policy if exists "Owners can update their service image objects" on storage.objects;
drop policy if exists "Owners can delete their service image objects" on storage.objects;
drop policy if exists "Public can read published service image objects" on storage.objects;
create policy "Public can read published service image objects"
on storage.objects for select
to anon, authenticated
using (
    bucket_id = 'service-images'
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (
        select 1
        from public.service_images as si
        join public.services as s on s.id = si.service_id
        where si.storage_path = storage.objects.name
          and s.status = 'published'
    )
);

drop policy if exists "Owners can manage their service image objects" on storage.objects;
create policy "Owners can manage their service image objects"
on storage.objects for all
to authenticated
using (
    bucket_id = 'service-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
)
with check (
    bucket_id = 'service-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
        select 1
        from public.services
        where services.id::text = (storage.foldername(name))[2]
          and services.owner_id = (select auth.uid())
    )
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);
