(function () {
    const categories = [
        'تصميم وإبداع',
        'برمجة وتقنية',
        'كتابة وترجمة',
        'تسويق وأعمال',
        'تعليم وتدريب',
        'خدمات أخرى'
    ];
    const orderStatusTransitions = Object.freeze({
        buyer: Object.freeze({
            pending: Object.freeze(['cancelled'])
        }),
        provider: Object.freeze({
            pending: Object.freeze(['accepted', 'rejected']),
            accepted: Object.freeze(['in_progress']),
            in_progress: Object.freeze(['completed'])
        })
    });

    async function getClient() {
        if (!window.PlatformSupabase) {
            throw new Error('إعداد Supabase غير محمّل في هذه الصفحة.');
        }
        return window.PlatformSupabase.ready;
    }

    function mapService(row) {
        return {
            id: row.id,
            ownerId: row.owner_id,
            name: row.name,
            description: row.description,
            category: row.category,
            price: Number(row.price),
            status: row.status || 'published',
            providerName: row.provider_name || '',
            createdAt: row.created_at,
            imageData: '',
            images: []
        };
    }

    function createId() {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    async function signImage(client, storagePath) {
        const { data, error } = await client
            .storage
            .from('service-images')
            .createSignedUrl(storagePath, 300);
        if (error) {
            throw error;
        }
        return data.signedUrl;
    }

    async function attachImages(client, services) {
        if (services.length === 0) {
            return services;
        }

        const serviceIds = services.map((service) => service.id);
        const { data: imageRows, error } = await client
            .from('service_images')
            .select('id, service_id, storage_path, alt_text, sort_order, created_at')
            .in('service_id', serviceIds)
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }

        const rowsByService = new Map();
        for (const row of imageRows || []) {
            const rows = rowsByService.get(row.service_id) || [];
            rows.push(row);
            rowsByService.set(row.service_id, rows);
        }

        for (const service of services) {
            const rows = rowsByService.get(service.id) || [];
            service.images = await Promise.all(rows.map(async (row) => ({
                id: row.id,
                storagePath: row.storage_path,
                altText: row.alt_text || '',
                sortOrder: row.sort_order,
                url: await signImage(client, row.storage_path)
            })));
            service.imageData = service.images.length ? service.images[0].url : '';
        }
        return services;
    }

    async function getAll() {
        const client = await getClient();
        const { data, error } = await client
            .from('public_services')
            .select('id, owner_id, name, description, category, price, created_at, provider_name')
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }

        return attachImages(client, (data || []).map(mapService));
    }

    async function getOwned(ownerId) {
        const client = await getClient();
        const { data, error } = await client
            .from('services')
            .select('id, owner_id, name, description, category, price, status, created_at')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }

        return attachImages(client, (data || []).map(mapService));
    }

    async function getById(id, ownerId) {
        const client = await getClient();
        let query;
        if (ownerId) {
            query = client
                .from('services')
                .select('id, owner_id, name, description, category, price, status, created_at')
                .eq('id', id)
                .eq('owner_id', ownerId)
                .maybeSingle();
        } else {
            query = client
                .from('public_services')
                .select('id, owner_id, name, description, category, price, created_at, provider_name')
                .eq('id', id)
                .maybeSingle();
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }
        if (!data) {
            return null;
        }

        const [service] = await attachImages(client, [mapService(data)]);
        return service;
    }

    async function add(service) {
        const client = await getClient();
        const { data, error } = await client
            .from('services')
            .insert({
                owner_id: service.ownerId,
                name: service.name,
                description: service.description,
                category: service.category,
                price: service.price,
                status: service.status
            })
            .select('id, owner_id, name, description, category, price, status, created_at')
            .single();
        if (error) {
            throw error;
        }
        return mapService(data);
    }

    async function update(id, ownerId, changes) {
        const client = await getClient();
        const { data, error } = await client
            .from('services')
            .update({
                name: changes.name,
                description: changes.description,
                category: changes.category,
                price: changes.price,
                status: changes.status
            })
            .eq('id', id)
            .eq('owner_id', ownerId)
            .select('id, owner_id, name, description, category, price, status, created_at')
            .maybeSingle();
        if (error) {
            throw error;
        }
        return data ? mapService(data) : null;
    }

    async function saveImage(serviceId, ownerId, file) {
        const client = await getClient();
        const extensions = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp'
        };
        const extension = extensions[file.type];
        if (!extension) {
            throw new Error('اختر صورة بصيغة JPG أو PNG أو WEBP.');
        }
        if (file.size > 3 * 1024 * 1024) {
            throw new Error('يجب ألا يتجاوز حجم الصورة 3 ميغابايت.');
        }

        const { data: previousImages, error: previousImagesError } = await client
            .from('service_images')
            .select('id, storage_path')
            .eq('service_id', serviceId);
        if (previousImagesError) {
            throw previousImagesError;
        }

        const storagePath = `${ownerId}/${serviceId}/${createId()}.${extension}`;
        const { error: uploadError } = await client
            .storage
            .from('service-images')
            .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) {
            throw uploadError;
        }

        const { data: imageRow, error: insertError } = await client
            .from('service_images')
            .insert({ service_id: serviceId, storage_path: storagePath, sort_order: 0 })
            .select('id, storage_path')
            .single();
        if (insertError) {
            const { error: cleanupError } = await client.storage.from('service-images').remove([storagePath]);
            if (cleanupError) {
                throw new Error(`تعذر تسجيل الصورة، كما تعذر تنظيف الملف المرفوع: ${cleanupError.message}`);
            }
            throw insertError;
        }

        const oldRows = (previousImages || []).filter((row) => row.id !== imageRow.id);
        if (oldRows.length) {
            const { error: removeError } = await client
                .storage
                .from('service-images')
                .remove(oldRows.map((row) => row.storage_path));
            if (removeError) {
                throw new Error(`تم رفع الصورة الجديدة، لكن تعذر حذف بعض الصور السابقة: ${removeError.message}`);
            }

            const { error: deleteRowsError } = await client
                .from('service_images')
                .delete()
                .in('id', oldRows.map((row) => row.id));
            if (deleteRowsError) {
                throw new Error(`حُذفت ملفات الصور السابقة، لكن تعذر حذف سجلاتها: ${deleteRowsError.message}`);
            }
        }

        return signImage(client, imageRow.storage_path);
    }

    async function remove(id, ownerId) {
        const client = await getClient();
        const { data: imageRows, error: imagesError } = await client
            .from('service_images')
            .select('storage_path')
            .eq('service_id', id);
        if (imagesError) {
            throw imagesError;
        }

        const { data, error } = await client
            .from('services')
            .delete()
            .eq('id', id)
            .eq('owner_id', ownerId)
            .select('id')
            .maybeSingle();
        if (error) {
            throw error;
        }
        if (!data) {
            return false;
        }

        const paths = (imageRows || []).map((row) => row.storage_path);
        if (paths.length) {
            const { error: cleanupError } = await client.storage.from('service-images').remove(paths);
            if (cleanupError) {
                throw new Error(`حُذفت الخدمة، لكن تعذر تنظيف بعض ملفات صورها: ${cleanupError.message}`);
            }
        }
        return true;
    }

    async function createOrder(buyerId, serviceId) {
        const client = await getClient();
        const { data, error } = await client
            .from('service_orders')
            .insert({ buyer_id: buyerId, service_id: serviceId })
            .select('id, buyer_id, service_id, price_at_order, status, created_at, updated_at, completed_at')
            .single();
        if (error) {
            throw error;
        }
        return data;
    }

    async function getBuyerOrders(buyerId) {
        const client = await getClient();
        const { data, error } = await client
            .from('service_orders')
            .select('id, buyer_id, service_id, price_at_order, status, created_at, updated_at, completed_at, services(name, owner_id)')
            .eq('buyer_id', buyerId)
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }
        return data || [];
    }

    async function getProviderOrders(providerId) {
        const client = await getClient();
        const { data, error } = await client
            .from('service_orders')
            .select('id, buyer_id, service_id, price_at_order, status, created_at, updated_at, completed_at, services!inner(name, owner_id)')
            .eq('services.owner_id', providerId)
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }
        return data || [];
    }

    function getAllowedOrderStatuses(currentStatus, actorRole) {
        const roleTransitions = orderStatusTransitions[actorRole];
        return roleTransitions && roleTransitions[currentStatus]
            ? roleTransitions[currentStatus]
            : [];
    }

    async function updateOrderStatus(orderId, currentStatus, nextStatus, actorRole) {
        if (!getAllowedOrderStatuses(currentStatus, actorRole).includes(nextStatus)) {
            throw new Error('لا يسمح انتقال حالة الطلب بهذا الإجراء.');
        }

        const client = await getClient();
        const { data, error } = await client
            .from('service_orders')
            .update({ status: nextStatus })
            .eq('id', orderId)
            .select('id, buyer_id, service_id, price_at_order, status, created_at, updated_at, completed_at')
            .maybeSingle();
        if (error) {
            throw error;
        }
        if (!data) {
            throw new Error('لم يتم تحديث الطلب؛ قد لا تملك الصلاحية أو لم يعد الطلب موجودًا.');
        }
        return data;
    }

    window.PlatformServiceStore = Object.freeze({
        categories,
        createId,
        getAll,
        getOwned,
        getById,
        add,
        update,
        saveImage,
        remove,
        createOrder,
        getBuyerOrders,
        getProviderOrders,
        getAllowedOrderStatuses,
        updateOrderStatus
    });
})();
