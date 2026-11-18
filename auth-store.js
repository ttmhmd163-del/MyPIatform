(function () {
    function normalizeEmail(email) {
        return email.trim().toLocaleLowerCase('en-US');
    }

    async function getClient() {
        if (!window.PlatformSupabase) {
            throw new Error('إعداد Supabase غير محمّل في هذه الصفحة.');
        }
        return window.PlatformSupabase.ready;
    }

    async function getProfile(client, user) {
        const { data, error } = await client
            .from('profiles')
            .select('id, name, email, phone, preferences')
            .eq('id', user.id)
            .maybeSingle();

        if (error) {
            throw error;
        }
        if (!data) {
            throw new Error('لم يُنشأ الملف الشخصي لهذا الحساب؛ راجع مشغّل إنشاء الملفات في Supabase.');
        }

        return {
            id: data.id,
            name: data.name,
            email: user.email || data.email || '',
            phone: data.phone || '',
            preferences: data.preferences || {
                requestNotifications: false,
                messageNotifications: false
            }
        };
    }

    async function register({ name, email, phone, password }) {
        const client = await getClient();
        const normalizedEmail = normalizeEmail(email);
        const { data, error } = await client.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
                data: {
                    name: name.trim(),
                    phone: phone.trim()
                }
            }
        });

        if (error) {
            throw error;
        }
        if (!data.user) {
            throw new Error('لم يُرجع Supabase مستخدمًا بعد التسجيل.');
        }
        if (!data.session) {
            return {
                id: data.user.id,
                name: name.trim(),
                email: normalizedEmail,
                phone: phone.trim(),
                needsEmailConfirmation: true
            };
        }

        return getProfile(client, data.user);
    }

    async function requestPasswordReset(email) {
        const client = await getClient();
        const redirectTo = new URL('reset-password.html', window.location.href).href;
        const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
            redirectTo
        });

        if (error) {
            throw error;
        }
    }

    async function resendSignupConfirmation(email) {
        const client = await getClient();
        const { error } = await client.auth.resend({
            type: 'signup',
            email: normalizeEmail(email)
        });

        if (error) {
            throw error;
        }
    }

    async function updatePassword(password) {
        const client = await getClient();
        const { data, error } = await client.auth.updateUser({ password });

        if (error) {
            throw error;
        }
        if (!data.user) {
            throw new Error('لم يُرجع Supabase مستخدمًا بعد تحديث كلمة المرور.');
        }
    }

    async function login(email, password) {
        const client = await getClient();
        const { data, error } = await client.auth.signInWithPassword({
            email: normalizeEmail(email),
            password
        });

        if (error) {
            throw error;
        }
        if (!data.user) {
            throw new Error('لم يُرجع Supabase مستخدمًا بعد تسجيل الدخول.');
        }

        return getProfile(client, data.user);
    }

    async function getCurrentUser() {
        const client = await getClient();
        const { data, error } = await client.auth.getSession();
        if (error) {
            throw error;
        }
        if (!data.session) {
            return null;
        }

        return getProfile(client, data.session.user);
    }

    async function getPublicUser(userId) {
        const client = await getClient();
        const { data, error } = await client
            .from('public_profiles')
            .select('id, name')
            .eq('id', userId)
            .maybeSingle();

        if (error) {
            throw error;
        }
        return data ? { id: data.id, name: data.name } : null;
    }

    async function updateProfile({ name, email, phone }) {
        const client = await getClient();
        const user = await getCurrentUser();
        if (!user) {
            throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى.');
        }

        const normalizedEmail = normalizeEmail(email);
        let emailChangePending = false;
        if (normalizedEmail !== normalizeEmail(user.email)) {
            const { data, error } = await client.auth.updateUser({ email: normalizedEmail });
            if (error) {
                throw error;
            }
            emailChangePending = Boolean(data.user && data.user.email !== normalizedEmail);
        }

        const { error } = await client
            .from('profiles')
            .update({ name: name.trim(), phone: phone.trim() })
            .eq('id', user.id);
        if (error) {
            throw error;
        }

        const updatedUser = await getCurrentUser();
        if (!updatedUser) {
            throw new Error('انتهت الجلسة؛ أعد تسجيل الدخول لحفظ الملف الشخصي.');
        }
        return { ...updatedUser, emailChangePending };
    }

    async function savePreferences(preferences) {
        const client = await getClient();
        const user = await getCurrentUser();
        if (!user) {
            throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى.');
        }

        const normalizedPreferences = {
            requestNotifications: Boolean(preferences.requestNotifications),
            messageNotifications: Boolean(preferences.messageNotifications)
        };
        const { data, error } = await client
            .from('profiles')
            .update({ preferences: normalizedPreferences })
            .eq('id', user.id)
            .select('preferences')
            .single();

        if (error) {
            throw error;
        }
        return data.preferences;
    }

    async function getAvatarUrl() {
        const client = await getClient();
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) {
            throw userError;
        }
        if (!userData.user) {
            throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى.');
        }

        const bucket = client.storage.from('profile-avatars');
        const { data: files, error: listError } = await bucket.list(userData.user.id, {
            limit: 1,
            search: 'avatar'
        });
        if (listError) {
            throw listError;
        }
        if (!(files || []).some((file) => file.name === 'avatar')) {
            return '';
        }

        const { data, error } = await bucket.createSignedUrl(`${userData.user.id}/avatar`, 3600);
        if (error) {
            throw error;
        }
        return data.signedUrl;
    }

    async function saveAvatar(file) {
        const extensions = ['image/jpeg', 'image/png', 'image/webp'];
        if (!extensions.includes(file.type)) {
            throw new Error('اختر صورة بصيغة JPG أو PNG أو WEBP.');
        }
        if (file.size > 3 * 1024 * 1024) {
            throw new Error('يجب ألا يتجاوز حجم الصورة 3 ميغابايت.');
        }

        const client = await getClient();
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) {
            throw userError;
        }
        if (!userData.user) {
            throw new Error('انتهت الجلسة؛ سجّل الدخول مرة أخرى.');
        }

        const bucket = client.storage.from('profile-avatars');
        const storagePath = `${userData.user.id}/avatar`;
        const { error: uploadError } = await bucket.upload(storagePath, file, {
            cacheControl: '0',
            contentType: file.type,
            upsert: true
        });
        if (uploadError) {
            throw uploadError;
        }

        const { data, error } = await bucket.createSignedUrl(storagePath, 3600);
        if (error) {
            throw error;
        }
        return data.signedUrl;
    }

    async function logout() {
        const client = await getClient();
        const { error } = await client.auth.signOut();
        if (error) {
            throw error;
        }
    }

    window.PlatformAuth = Object.freeze({
        register,
        requestPasswordReset,
        resendSignupConfirmation,
        updatePassword,
        login,
        getCurrentUser,
        getPublicUser,
        updateProfile,
        savePreferences,
        getAvatarUrl,
        saveAvatar,
        logout
    });
})();
