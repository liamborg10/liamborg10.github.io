// ============================================================
// UNIFIED PORTFOLIO MOTION ENGINE
// ============================================================
(() => {
    const MOTION = {
        pageExit: 480,
        sectionExit: 380,
        sectionOpenDelay: 60,
        carouselIntro: 600,
        carouselFocus: 460,
        carouselButtonStep: 280,
        photoClose: 520,
        photoRecover: 560,
        cardReturn: 620,
        cardStagger: 36
    };

    const EASE = {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)'
    };

    const IS_SAFARI = /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i.test(navigator.userAgent);

    const state = {
        tracks: [],
        trackMap: new Map(),
        targetFocalX: window.innerWidth / 2,
        currentFocalX: window.innerWidth / 2,
        autoScrollSpeed: 0,
        engineRunning: false,
        physicsFrame: null,
        lastPhysicsTime: 0,
        sectionBusy: false,
        isNavigating: false,
        touchStartX: 0,
        touchStartY: 0,
        photoSpotlightOverlay: null,
        photoSpotlightItem: null,
        photoSpotlightTrack: null,
        photoSpotlightPlaceholder: null,
        photoSpotlightClearTimer: null,
        photoSpotlightRecoverStartedAt: 0,
        photoSpotlightRecoverUntil: 0,
        photoSpotlightOpenPending: false,
        photoImageWarmers: new Map(),
        photoBackgroundWarmTracks: new WeakSet()
    };

    const MAIN_PAGE_URL = 'index.html';
    const MAIN_NAV_RETURN_KEY = 'portfolioMainNavReturn';

    function canAnimate() {
        return true;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function springEase(t) {
        const c1 = 0.28;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    function getHeaderOffset() {
        const header = document.querySelector('header');
        return (header ? header.offsetHeight : 56) + 42;
    }

    function scrollToSection(targetY) {
        window.scrollTo({
            top: Math.max(0, targetY),
            behavior: canAnimate() ? 'smooth' : 'auto'
        });
    }

    function waitForWindowScroll(targetY, timeout = MOTION.carouselFocus) {
        const target = Math.max(0, targetY);

        if (!canAnimate()) {
            window.scrollTo({ top: target, behavior: 'auto' });
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const startedAt = performance.now();

            const check = () => {
                const isSettled = Math.abs(window.scrollY - target) < 3;
                const timedOut = performance.now() - startedAt > timeout;

                if (isSettled || timedOut) {
                    if (!isSettled) {
                        window.scrollTo({ top: target, behavior: 'auto' });
                    }
                    resolve();
                    return;
                }

                requestAnimationFrame(check);
            };

            requestAnimationFrame(check);
        });
    }

    function getUniqueSections(selector) {
        return Array.from(new Set(document.querySelectorAll(selector)));
    }

    function getSectionTop(section) {
        return section.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
    }

    function getTrackPresentationSection(trackObj) {
        return trackObj?.element?.closest('.carousel-view-container, .expansion-section, .level-2');
    }

    function getGalleryOpenScrollNudge() {
        return clamp(window.innerHeight * 0.035, 20, 34);
    }

    function markSectionPresentedScroll(section, targetY = getSectionTop(section)) {
        if (!section) return;
        section.dataset.galleryPresentedScrollY = String(Math.round(Math.max(0, targetY)));
    }

    function hasSectionScrolledFromPresentedView(section) {
        if (!section) return false;

        const storedY = Number(section.dataset.galleryPresentedScrollY);
        const presentedY = Number.isFinite(storedY)
            ? storedY
            : Math.max(0, getSectionTop(section));

        return Math.abs(window.scrollY - presentedY) > 34;
    }

    function getTrackCenterTarget(trackEl, item) {
        const target = item.offsetLeft - (trackEl.clientWidth / 2) + (item.clientWidth / 2);
        return clamp(target, 0, Math.max(0, trackEl.scrollWidth - trackEl.clientWidth));
    }

    function restartStagger(trackEl) {
        trackEl.classList.remove('stagger-in');
        trackEl.querySelectorAll('.photo-return-restored').forEach(item => {
            const frame = item.querySelector('.photo-frame');
            if (frame) {
                frame.style.animation = '';
                frame.style.opacity = '';
            }
            item.classList.remove('photo-return-restored');
        });
        void trackEl.offsetWidth;
        trackEl.classList.add('stagger-in');
    }

    function prepareCarouselIntroStagger(trackObj, anchorItem) {
        const anchorIndex = Math.max(0, trackObj.items.indexOf(anchorItem));

        trackObj.items.forEach((item, index) => {
            const offset = index - anchorIndex;
            const distance = Math.abs(offset);
            const direction = offset < 0 ? -1 : 1;
            const enterX = offset === 0 ? 0 : direction * clamp(18 + (distance * 7), 18, 56);
            const delay = Math.round(clamp(distance * 34, 0, 190));

            item.classList.toggle('carousel-enter-item', distance <= 4);
            item.style.setProperty('--carousel-enter-delay', `${delay}ms`);
            item.style.setProperty('--carousel-enter-x', `${enterX}px`);
            item.style.setProperty('--photo-enter-x', `${enterX * 0.42}px`);
        });
    }

    function markCarouselIntro(trackObj) {
        const section = trackObj.element.closest('.carousel-view-container');

        if (trackObj.introTimer) {
            clearTimeout(trackObj.introTimer);
        }

        trackObj.element.classList.add('carousel-intro-active');
        section?.classList.add('carousel-intro-active');

        trackObj.introTimer = setTimeout(() => {
            trackObj.element.classList.remove('carousel-intro-active');
            section?.classList.remove('carousel-intro-active');
            trackObj.introTimer = null;
        }, canAnimate() ? MOTION.carouselIntro + 260 : 0);
    }

    function resetTrackItems(trackObj) {
        trackObj.element.classList.remove('carousel-controls-hovered');
        trackObj.element.classList.remove('carousel-intro-active');
        trackObj.element.closest('.carousel-view-container')?.classList.remove('carousel-intro-active', 'carousel-loading');
        trackObj.controlsFocus = 0;
        trackObj.controlsFocusTarget = 0;

        if (trackObj.introTimer) {
            clearTimeout(trackObj.introTimer);
            trackObj.introTimer = null;
        }

        if (trackObj.photoRestoreTimer) {
            clearTimeout(trackObj.photoRestoreTimer);
            trackObj.photoRestoreTimer = null;
        }

        trackObj.items.forEach(item => {
            item.classList.remove('photo-return-restored');
            item.classList.remove('carousel-enter-item');
            item.classList.remove('photo-expand-hint');
            item.classList.remove('photo-expand-hint-exit');
            item.style.transform = '';
            item.style.opacity = '';
            item.style.zIndex = '';
            item.__portfolioMotion = null;
        });

        trackObj.expandHintItem = null;
        trackObj.lastRenderedScrollLeft = null;
        trackObj.lastRenderedFocalX = null;
        trackObj.lastRenderedControlsFocus = null;
        trackObj.lastRenderedPhotoStateActive = null;
    }

    function decodeImageSource(src) {
        if (!src) return Promise.resolve();
        if (state.photoImageWarmers.has(src)) return state.photoImageWarmers.get(src);

        const warmPromise = new Promise(resolve => {
            const image = new Image();
            const finish = () => {
                if (image.decode) {
                    image.decode().catch(() => {}).then(resolve);
                } else {
                    resolve();
                }
            };

            image.decoding = 'async';
            image.onload = finish;
            image.onerror = resolve;
            image.src = src;

            if (image.complete) {
                finish();
            }
        });

        state.photoImageWarmers.set(src, warmPromise);
        return warmPromise;
    }

    function scheduleIdleTask(callback, timeout = 900) {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(callback, { timeout });
        } else {
            setTimeout(callback, timeout);
        }
    }

    function decodeImageSourcesSequentially(urls) {
        return urls.reduce((chain, src) => {
            return chain.then(() => decodeImageSource(src));
        }, Promise.resolve());
    }

    function warmPhotoTrack(trackEl) {
        if (!trackEl?.classList.contains('photo-carousel-track')) return Promise.resolve();

        const priorityUrls = [];
        const deferredUrls = [];
        const seen = new Set();
        const images = Array.from(trackEl.querySelectorAll('img'));
        const configuredPriorityCount = Math.min(
            images.length,
            Math.max(1, Number(trackEl.dataset.carouselWarmCount || 4))
        );
        const priorityCount = IS_SAFARI
            ? Math.min(images.length, Math.max(configuredPriorityCount, 7))
            : configuredPriorityCount;

        images.forEach((image, index) => {
            const isPriority = index < priorityCount;
            image.loading = isPriority ? 'eager' : 'lazy';
            image.decoding = 'async';
            image.fetchPriority = index === 0 ? 'high' : (isPriority ? 'auto' : 'low');

            const src = image.currentSrc || image.src;
            if (src && !seen.has(src)) {
                seen.add(src);
                (isPriority ? priorityUrls : deferredUrls).push(src);
            }
        });

        if (deferredUrls.length > 0 && !state.photoBackgroundWarmTracks.has(trackEl)) {
            state.photoBackgroundWarmTracks.add(trackEl);
            scheduleIdleTask(() => {
                decodeImageSourcesSequentially(deferredUrls);
            }, IS_SAFARI ? 360 : 700);
        }

        if (priorityUrls.length === 0) return Promise.resolve();
        return Promise.allSettled(priorityUrls.map(decodeImageSource));
    }

    function scheduleSafariPhotoWarmup() {
        if (!IS_SAFARI) return;

        scheduleIdleTask(() => {
            const tracks = Array.from(document.querySelectorAll('.photo-carousel-track'));
            tracks.reduce((chain, trackEl) => {
                return chain.then(() => warmPhotoTrack(trackEl));
            }, Promise.resolve());
        }, 650);
    }

    function setPhotoRectVars(overlay, name, rect) {
        overlay.style.setProperty(`--photo-${name}-left`, `${rect.left}px`);
        overlay.style.setProperty(`--photo-${name}-top`, `${rect.top}px`);
        overlay.style.setProperty(`--photo-${name}-width`, `${rect.width}px`);
        overlay.style.setProperty(`--photo-${name}-height`, `${rect.height}px`);
    }

    function parseCssPixelValue(value) {
        const parsed = Number.parseFloat(String(value || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function getPhotoBaseMetrics(item, image, fallbackRect) {
        const computed = window.getComputedStyle(image);
        const radii = [
            computed.borderTopLeftRadius,
            computed.borderTopRightRadius,
            computed.borderBottomRightRadius,
            computed.borderBottomLeftRadius
        ].map(parseCssPixelValue);

        return {
            width: image.offsetWidth || item.offsetWidth || fallbackRect?.width || 1,
            height: image.offsetHeight || item.offsetHeight || fallbackRect?.height || 1,
            radii
        };
    }

    function storePhotoBaseMetrics(item, metrics) {
        item.dataset.photoBaseWidth = String(metrics.width);
        item.dataset.photoBaseHeight = String(metrics.height);
        item.dataset.photoBaseRadii = metrics.radii.join(',');
    }

    function getStoredPhotoBaseMetrics(item, image, fallbackRect) {
        const storedRadii = (item?.dataset.photoBaseRadii || '')
            .split(',')
            .map(Number)
            .filter(Number.isFinite);

        if (item?.dataset.photoBaseWidth && item?.dataset.photoBaseHeight && storedRadii.length === 4) {
            return {
                width: Number(item.dataset.photoBaseWidth) || fallbackRect?.width || 1,
                height: Number(item.dataset.photoBaseHeight) || fallbackRect?.height || 1,
                radii: storedRadii
            };
        }

        return getPhotoBaseMetrics(item, image, fallbackRect);
    }

    function setPhotoRadiusVars(overlay, name, rect, metrics) {
        const widthScale = rect.width / Math.max(metrics.width, 1);
        const heightScale = rect.height / Math.max(metrics.height, 1);
        const scale = Math.max(widthScale, heightScale, 0.01);
        const radiusValue = metrics.radii
            .map(radius => `${(radius * scale).toFixed(2)}px`)
            .join(' ');

        overlay.style.setProperty(`--photo-${name}-radius`, radiusValue);
    }

    function setPhotoGeometryVars(overlay, name, rect, metrics) {
        setPhotoRectVars(overlay, name, rect);

        if (metrics) {
            setPhotoRadiusVars(overlay, name, rect, metrics);
        }
    }

    function getPhotoSourceRect(item) {
        const image = item.querySelector('img');
        return (image || item).getBoundingClientRect();
    }

    function isStaticPhotoGallery(trackObj) {
        return Boolean(trackObj?.staticGallery || trackObj?.element?.classList.contains('photo-gallery-track'));
    }

    function createPhotoLiftPlaceholder(item) {
        const baseClassName = item.className
            .replace(/\bis-photo-spotlight\b/g, '')
            .replace(/\bphoto-lifted\b/g, '')
            .replace(/\bphoto-return-restored\b/g, '')
            .trim();
        const placeholder = document.createElement('div');
        placeholder.className = `${baseClassName} photo-lift-placeholder`.trim();
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.dataset.originalId = item.id || '';

        if (item.id) {
            placeholder.id = item.id;
            item.removeAttribute('id');
        }

        placeholder.style.width = `${item.offsetWidth}px`;
        placeholder.style.height = `${item.offsetHeight}px`;
        placeholder.style.flex = `0 0 ${item.offsetWidth}px`;
        return placeholder;
    }

    function getPhotoFinalRect(item, image) {
        const header = document.querySelector('header');
        const headerHeight = header ? header.offsetHeight : 65;
        const padding = clamp(window.innerWidth * 0.05, 28, 64);
        const availableViewportHeight = Math.max(160, window.innerHeight - headerHeight);
        const naturalWidth = image.naturalWidth || Number(image.getAttribute('width')) || 1;
        const naturalHeight = image.naturalHeight || Number(image.getAttribute('height')) || 1;
        const sourceRect = getPhotoSourceRect(item);
        const aspectRatio = naturalWidth > 1 && naturalHeight > 1
            ? naturalWidth / naturalHeight
            : Math.max(sourceRect.width / Math.max(sourceRect.height, 1), 0.2);
        const widthLimit = item.classList.contains('photo-landscape')
            ? Math.min(window.innerWidth * 0.9, 1480)
            : Math.min(window.innerWidth * 0.88, 1320);
        const heightLimit = item.classList.contains('photo-portrait')
            ? Math.min(availableViewportHeight * 0.84, 860)
            : Math.min(availableViewportHeight * 0.82, 820);
        const maxWidth = Math.max(160, Math.min(widthLimit, window.innerWidth - (padding * 2)));
        const maxHeight = Math.max(160, Math.min(heightLimit, availableViewportHeight - (padding * 2)));
        let width = maxWidth;
        let height = width / aspectRatio;

        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }

        const finalTop = headerHeight + ((availableViewportHeight - height) / 2);
        const finalScale = 0.96;
        width *= finalScale;
        height *= finalScale;

        return {
            left: (window.innerWidth - width) / 2,
            top: finalTop,
            width,
            height
        };
    }

    function positionPhotoReturnButton(overlay, trackObj) {
        const sourceButton = trackObj.element.closest('.carousel-view-container')?.querySelector('.section-back-btn');
        const returnButton = overlay.querySelector('.photo-lightbox-return');
        const originalLabel = returnButton.querySelector('.return-label-original');
        const sourceRect = sourceButton ? sourceButton.getBoundingClientRect() : null;

        originalLabel.textContent = sourceButton ? sourceButton.textContent.trim() : '↑ Back to Photography';

        if (sourceRect && sourceRect.width > 0 && sourceRect.height > 0) {
            overlay.style.setProperty('--photo-return-left', `${sourceRect.left}px`);
            overlay.style.setProperty('--photo-return-top', `${sourceRect.top}px`);
        } else {
            overlay.style.setProperty('--photo-return-left', '5vw');
            overlay.style.setProperty('--photo-return-top', '92px');
        }
    }

    function preparePhotoGalleryFlight(trackObj, anchorItem) {
        if (!trackObj?.element || !anchorItem) return;

        const anchorRect = anchorItem.getBoundingClientRect();
        const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
        const anchorCenterY = anchorRect.top + (anchorRect.height / 2);
        const photoItems = Array.from(trackObj.element.querySelectorAll('.photo-item:not(.photo-lift-placeholder)'));

        photoItems.forEach((item, index) => {
            if (item.classList.contains('is-photo-spotlight')) return;

            const rect = item.getBoundingClientRect();
            const centerX = rect.left + (rect.width / 2);
            const centerY = rect.top + (rect.height / 2);
            const side = centerX < anchorCenterX ? -1 : 1;
            const horizontalDistance = Math.abs(centerX - anchorCenterX);
            const verticalDistance = Math.abs(centerY - anchorCenterY);
            const flyX = side * clamp(78 + (horizontalDistance * 0.16), 90, 240);
            const flyY = clamp(14 + (verticalDistance * 0.06), 16, 34);
            const delay = Math.round(clamp(index * 22, 0, 154));

            item.style.setProperty('--gallery-fly-x', `${flyX}px`);
            item.style.setProperty('--gallery-fly-y', `${flyY}px`);
            item.style.setProperty('--gallery-fly-delay', `${delay}ms`);
            item.style.setProperty('--gallery-return-delay', '0ms');
        });
    }

    function clearPhotoGalleryFlight(trackObj) {
        trackObj?.element?.querySelectorAll('.photo-item').forEach(item => {
            item.style.removeProperty('--gallery-fly-x');
            item.style.removeProperty('--gallery-fly-y');
            item.style.removeProperty('--gallery-fly-delay');
            item.style.removeProperty('--gallery-return-delay');
        });
    }

    function getItemCenterX(item) {
        const rect = item?.getBoundingClientRect?.();
        return rect ? rect.left + (rect.width / 2) : window.innerWidth / 2;
    }

    function getPhotoFocusedScale(item) {
        if (!item?.classList?.contains('photo-item')) return 1;
        return item.classList.contains('photo-portrait') ? 1.3 : 1.15;
    }

    function scaleRectFromCenter(rect, scale) {
        const width = rect.width * scale;
        const height = rect.height * scale;

        return {
            left: rect.left + ((rect.width - width) / 2),
            top: rect.top + ((rect.height - height) / 2),
            width,
            height
        };
    }

    function getPhotoReturnRect(trackObj, activeItem, targetSlot) {
        if (!activeItem) return null;
        const baseTarget = targetSlot && activeItem !== targetSlot ? targetSlot : activeItem;
        const baseRect = baseTarget.getBoundingClientRect?.() || getPhotoSourceRect(activeItem);

        if (!trackObj?.element || isStaticPhotoGallery(trackObj)) {
            return baseRect;
        }

        return scaleRectFromCenter(baseRect, getPhotoFocusedScale(activeItem));
    }

    function beginPhotoCarouselRecover(trackObjOrId, options = {}) {
        const trackObj = typeof trackObjOrId === 'string'
            ? state.trackMap.get(trackObjOrId)
            : trackObjOrId;
        const duration = options.duration ?? MOTION.photoRecover;
        const focusItem = options.focusItem || null;

        state.photoSpotlightRecoverStartedAt = performance.now();
        state.photoSpotlightRecoverUntil = state.photoSpotlightRecoverStartedAt + (canAnimate() ? duration : 0);

        if (focusItem && trackObj?.element && !isStaticPhotoGallery(trackObj)) {
            const focalX = getItemCenterX(focusItem);
            state.targetFocalX = focalX;
            state.currentFocalX = focalX;
        } else {
            state.targetFocalX = window.innerWidth / 2;
            state.currentFocalX = window.innerWidth / 2;
        }

        if (trackObj?.element && !isStaticPhotoGallery(trackObj)) {
            updateTrackItems(trackObj);
        }
    }

    function restoreLiftedPhotoItem() {
        const item = state.photoSpotlightItem;
        const placeholder = state.photoSpotlightPlaceholder;
        const placeholderId = placeholder?.dataset.originalId || placeholder?.id || '';

        if (item) {
            const frame = item.querySelector('.photo-frame');
            item.classList.remove('is-photo-spotlight', 'photo-lifted');
            item.classList.add('photo-return-restored');
            item.style.transform = '';
            item.style.opacity = '';
            item.style.zIndex = '';

            if (frame) {
                frame.style.animation = 'none';
                frame.style.opacity = '1';
            }
        }

        if (item && placeholder && placeholder.parentNode) {
            if (placeholderId) {
                item.id = placeholderId;
            }

            placeholder.replaceWith(item);
        } else if (item && state.photoSpotlightTrack?.element && !state.photoSpotlightTrack.element.contains(item)) {
            if (placeholderId) {
                item.id = placeholderId;
            }

            state.photoSpotlightTrack.element.appendChild(item);
        }

        if (placeholder && placeholder.parentNode) {
            placeholder.remove();
        }

        return item || null;
    }

    function finishPhotoSpotlightClear() {
        if (state.photoSpotlightClearTimer) {
            clearTimeout(state.photoSpotlightClearTimer);
            state.photoSpotlightClearTimer = null;
        }

        const restoredTrack = state.photoSpotlightTrack;
        const restoredItem = restoreLiftedPhotoItem();

        document.querySelectorAll('.photo-carousel-track.photo-spotlight-active, .photo-carousel-track.photo-spotlight-closing, .photo-carousel-track.photo-gallery-hidden, .photo-carousel-track.photo-gallery-returning, .photo-gallery-track.photo-spotlight-active, .photo-gallery-track.photo-spotlight-closing, .photo-gallery-track.photo-gallery-hidden, .photo-gallery-track.photo-gallery-returning').forEach(track => {
            track.classList.remove('photo-spotlight-active', 'photo-spotlight-closing', 'photo-gallery-hidden', 'photo-gallery-returning');
        });

        document.querySelectorAll('.photo-item.is-photo-spotlight').forEach(item => {
            item.classList.remove('is-photo-spotlight');
        });

        document.body.classList.remove('photo-lightbox-active');

        if (state.photoSpotlightOverlay) {
            state.photoSpotlightOverlay.classList.remove('opening', 'active', 'closing', 'portrait', 'landscape');
            state.photoSpotlightOverlay.setAttribute('aria-hidden', 'true');
        }

        beginPhotoCarouselRecover(restoredTrack, {
            duration: 0,
            focusItem: restoredItem
        });

        if (restoredTrack) {
            clearPhotoGalleryFlight(restoredTrack);

            if (restoredTrack.photoRestoreTimer) {
                clearTimeout(restoredTrack.photoRestoreTimer);
            }

            restoredTrack.photoRestoreTimer = setTimeout(() => {
                restoredTrack.element.querySelectorAll('.photo-return-restored').forEach(item => {
                    item.classList.remove('photo-return-restored');
                });
                restoredTrack.photoRestoreTimer = null;
            }, canAnimate() ? MOTION.photoRecover + 120 : 0);
        }

        state.photoSpotlightItem = null;
        state.photoSpotlightTrack = null;
        state.photoSpotlightPlaceholder = null;
    }

    function clearPhotoSpotlight(options = {}) {
        const overlay = state.photoSpotlightOverlay;
        const activeItem = state.photoSpotlightItem || document.querySelector('.photo-item.is-photo-spotlight');
        const activeTrack = state.photoSpotlightTrack;

        if (!overlay || !document.body.classList.contains('photo-lightbox-active') || options.instant || !canAnimate()) {
            finishPhotoSpotlightClear();
            return;
        }

        if (overlay.classList.contains('closing')) return;

        document.querySelectorAll('.photo-carousel-track.photo-spotlight-active, .photo-gallery-track.photo-spotlight-active').forEach(track => {
            track.classList.add('photo-spotlight-closing');
        });

        const targetSlot = state.photoSpotlightPlaceholder || activeItem;

        if (activeTrack?.element) {
            if (targetSlot && activeTrack.element.contains(targetSlot) && !isStaticPhotoGallery(activeTrack)) {
                if (activeTrack.hScrollAnim) {
                    cancelAnimationFrame(activeTrack.hScrollAnim);
                    activeTrack.hScrollAnim = null;
                }

                activeTrack.element.scrollLeft = getTrackCenterTarget(activeTrack.element, targetSlot);
            }

            if (targetSlot && !isStaticPhotoGallery(activeTrack)) {
                const focalX = getItemCenterX(targetSlot);
                state.targetFocalX = focalX;
                state.currentFocalX = focalX;
            }

            preparePhotoGalleryFlight(activeTrack, targetSlot);
            activeTrack.element.classList.add('photo-gallery-returning');
            activeTrack.element.classList.remove('photo-gallery-hidden');
        }

        const returnRect = getPhotoReturnRect(activeTrack, activeItem, targetSlot);

        if (returnRect) {
            const image = activeItem?.querySelector('img');
            const metrics = image ? getStoredPhotoBaseMetrics(activeItem, image, returnRect) : null;
            setPhotoGeometryVars(overlay, 'start', returnRect, metrics);
        }

        overlay.classList.add('closing');
        overlay.classList.remove('opening', 'active');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.setProperty('--photo-lightbox-close-duration', `${MOTION.photoClose}ms`);
        document.body.classList.remove('photo-lightbox-active');

        if (activeTrack?.element && !isStaticPhotoGallery(activeTrack)) {
            updateTrackItems(activeTrack);
        }

        let closeFinished = false;
        const closeStartedAt = performance.now();
        const minimumCloseDuration = MOTION.photoClose;
        const finishClose = () => {
            if (closeFinished) return;
            const remaining = minimumCloseDuration - (performance.now() - closeStartedAt);

            if (remaining > 16) {
                if (state.photoSpotlightClearTimer) {
                    clearTimeout(state.photoSpotlightClearTimer);
                }
                state.photoSpotlightClearTimer = setTimeout(finishClose, remaining);
                return;
            }

            closeFinished = true;
            activeItem?.removeEventListener('transitionend', handleCloseTransitionEnd);
            finishPhotoSpotlightClear();
        };

        const handleCloseTransitionEnd = event => {
            if (event.target !== activeItem) return;
            if (!['left', 'top', 'width', 'height'].includes(event.propertyName)) return;
            finishClose();
        };

        activeItem?.addEventListener('transitionend', handleCloseTransitionEnd);

        state.photoSpotlightClearTimer = setTimeout(finishClose, minimumCloseDuration + 120);
    }

    function getPhotoSpotlightOverlay() {
        if (state.photoSpotlightOverlay) return state.photoSpotlightOverlay;

        const overlay = document.createElement('div');
        overlay.className = 'photo-lightbox';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<div class="photo-lightbox-backdrop"></div><button class="photo-lightbox-return" type="button"><span class="return-label return-label-original"></span><span class="return-label return-label-carousel">&uarr; Back to Carousel</span></button>';

        overlay.addEventListener('click', clearPhotoSpotlight);
        overlay.querySelector('.photo-lightbox-return').addEventListener('click', event => {
            event.stopPropagation();
            clearPhotoSpotlight();
        });

        document.body.appendChild(overlay);
        state.photoSpotlightOverlay = overlay;
        return overlay;
    }

    function isPhotoOpenViewportSettled(trackObj, item, section) {
        if (!hasSectionScrolledFromPresentedView(section)) return true;

        const header = document.querySelector('header');
        const headerBottom = header ? header.getBoundingClientRect().bottom : 65;
        const backButton = section.querySelector('.section-back-btn');
        const backRect = backButton ? backButton.getBoundingClientRect() : null;
        const itemRect = item ? item.getBoundingClientRect() : null;
        const itemCenterY = itemRect ? itemRect.top + (itemRect.height / 2) : window.innerHeight / 2;

        const backButtonPresented = !backRect || (
            backRect.bottom > headerBottom + 8
            && backRect.top < Math.min(window.innerHeight * 0.38, headerBottom + 190)
        );
        const itemPresented = !itemRect || (
            itemRect.bottom > headerBottom + 80
            && itemRect.top < window.innerHeight - 42
            && itemCenterY > headerBottom + 120
            && itemCenterY < window.innerHeight - 72
        );

        return backButtonPresented && itemPresented && trackObj.element.getBoundingClientRect().bottom > headerBottom + 140;
    }

    function settleViewportForPhotoOpen(trackObj, item) {
        const section = getTrackPresentationSection(trackObj);
        if (!section || section.style.display === 'none') return Promise.resolve();
        if (isPhotoOpenViewportSettled(trackObj, item, section)) return Promise.resolve();

        const targetY = Math.max(0, getSectionTop(section) + getGalleryOpenScrollNudge());

        state.targetFocalX = window.innerWidth / 2;
        state.currentFocalX = window.innerWidth / 2;
        state.autoScrollSpeed = 0;
        scrollToSection(targetY);
        return waitForWindowScroll(targetY, canAnimate() ? MOTION.carouselFocus + 120 : 0);
    }

    function requestPhotoSpotlightOpen(trackObj, item, options = {}) {
        if (!trackObj?.element || !item || state.photoSpotlightOpenPending) return;
        if (document.body.classList.contains('photo-lightbox-active')) return;

        state.photoSpotlightOpenPending = true;

        if (options.centerInTrack && !isStaticPhotoGallery(trackObj)) {
            horizontalSpringTo(trackObj, getTrackCenterTarget(trackObj.element, item));
        }

        settleViewportForPhotoOpen(trackObj, item)
            .then(() => {
                if (!trackObj.element.contains(item)) return;
                if (document.body.classList.contains('photo-lightbox-active')) return;
                activatePhotoSpotlight(trackObj, item);
            })
            .finally(() => {
                state.photoSpotlightOpenPending = false;
            });
    }

    function activatePhotoSpotlight(trackObj, item) {
        if (!item.classList.contains('photo-item')) return;

        const image = item.querySelector('img');
        if (!image) return;

        const overlay = getPhotoSpotlightOverlay();
        const sourceRect = getPhotoSourceRect(item);
        const finalRect = getPhotoFinalRect(item, image);
        const baseMetrics = getPhotoBaseMetrics(item, image, sourceRect);
        const placeholder = createPhotoLiftPlaceholder(item);

        clearPhotoSpotlight({ instant: true });
        resetTrackItems(trackObj);
        trackObj.element.classList.remove('stagger-in');
        storePhotoBaseMetrics(item, baseMetrics);
        item.parentNode.insertBefore(placeholder, item);
        preparePhotoGalleryFlight(trackObj, placeholder);
        trackObj.element.classList.remove('photo-spotlight-closing');
        trackObj.element.classList.remove('photo-gallery-returning');
        trackObj.element.classList.add('photo-spotlight-active', 'photo-gallery-hidden');
        item.classList.remove('photo-return-restored');
        item.classList.add('is-photo-spotlight', 'photo-lifted');
        document.body.classList.add('photo-lightbox-active');
        overlay.classList.remove('active', 'closing');
        overlay.classList.add('opening');
        overlay.classList.toggle('portrait', item.classList.contains('photo-portrait'));
        overlay.classList.toggle('landscape', item.classList.contains('photo-landscape'));
        overlay.setAttribute('aria-hidden', 'false');
        setPhotoGeometryVars(overlay, 'start', sourceRect, baseMetrics);
        setPhotoGeometryVars(overlay, 'final', finalRect, baseMetrics);
        positionPhotoReturnButton(overlay, trackObj);
        overlay.appendChild(item);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.remove('opening');
                overlay.classList.add('active');
            });
        });

        state.photoSpotlightItem = item;
        state.photoSpotlightTrack = trackObj;
        state.photoSpotlightPlaceholder = placeholder;
        state.targetFocalX = window.innerWidth / 2;
    }

    function horizontalSpringTo(trackObj, targetLeft, duration = MOTION.carouselFocus) {
        if (!trackObj || !trackObj.element) return;

        const trackEl = trackObj.element;
        const maxScroll = Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
        const target = clamp(targetLeft, 0, maxScroll);

        if (trackObj.hScrollAnim) {
            cancelAnimationFrame(trackObj.hScrollAnim);
        }

        if (!canAnimate()) {
            trackEl.scrollLeft = target;
            trackObj.hScrollAnim = null;
            return;
        }

        const startLeft = trackEl.scrollLeft;
        const diff = target - startLeft;
        let startTime = null;

        function step(time) {
            if (startTime === null) startTime = time;

            const elapsed = time - startTime;
            const progress = clamp(elapsed / duration, 0, 1);
            trackEl.scrollLeft = startLeft + (diff * springEase(progress));

            if (progress < 1) {
                trackObj.hScrollAnim = requestAnimationFrame(step);
            } else {
                trackEl.scrollLeft = target;
                trackObj.hScrollAnim = null;
            }
        }

        trackObj.hScrollAnim = requestAnimationFrame(step);
    }

    function getCenteredItemIndex(trackObj) {
        const trackEl = trackObj.element;
        const centerX = trackEl.scrollLeft + (trackEl.clientWidth / 2);
        let bestIndex = 0;
        let bestDistance = Infinity;

        trackObj.items.forEach((item, index) => {
            const itemCenterX = item.offsetLeft + (item.offsetWidth / 2);
            const distance = Math.abs(centerX - itemCenterX);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });

        return bestIndex;
    }

    function moveTrackByItem(trackObj, direction, duration = MOTION.carouselFocus, options = {}) {
        if (!trackObj || trackObj.items.length === 0) return;

        const currentIndex = getCenteredItemIndex(trackObj);
        const targetIndex = clamp(currentIndex + direction, 0, trackObj.items.length - 1);
        const targetItem = trackObj.items[targetIndex];

        if (!targetItem) return;

        state.targetFocalX = window.innerWidth / 2;
        horizontalSpringTo(trackObj, getTrackCenterTarget(trackObj.element, targetItem), duration);
    }

    function ensureTrackControls(trackObj) {
        if (!trackObj.element.classList.contains('photo-carousel-track')) return;

        const section = trackObj.element.closest('.carousel-view-container');
        if (trackObj.element.dataset.carouselControls === 'false') {
            section?.querySelectorAll('.carousel-nav-button').forEach(button => button.remove());
            return;
        }

        if (!section || section.dataset.carouselControlsBound === 'true') return;

        section.dataset.carouselControlsBound = 'true';

        const createButton = (direction, label, symbol) => {
            const button = document.createElement('button');
            let suppressClickUntil = 0;
            button.type = 'button';
            button.className = `carousel-nav-button carousel-nav-${direction < 0 ? 'prev' : 'next'}`;
            button.setAttribute('aria-label', label);
            button.innerHTML = symbol;
            button.addEventListener('pointerenter', () => {
                trackObj.element.classList.add('carousel-controls-hovered');
                trackObj.controlsFocusTarget = 1;
                state.targetFocalX = window.innerWidth / 2;
                state.autoScrollSpeed = 0;
            });
            button.addEventListener('pointerleave', () => {
                trackObj.element.classList.remove('carousel-controls-hovered');
                trackObj.controlsFocusTarget = 0;
                state.targetFocalX = window.innerWidth / 2;
            });
            button.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                suppressClickUntil = Date.now() + 450;
                moveTrackByItem(trackObj, direction, MOTION.carouselButtonStep);
            });
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (Date.now() < suppressClickUntil) return;
                moveTrackByItem(trackObj, direction, MOTION.carouselButtonStep);
            });

            return button;
        };

        section.append(
            createButton(-1, 'Previous image', '&lsaquo;'),
            createButton(1, 'Next image', '&rsaquo;')
        );
    }

    function bindTrackItems(trackObj) {
        trackObj.items.forEach(item => {
            if (item.dataset.carouselBound === 'true') return;

            item.dataset.carouselBound = 'true';
            item.addEventListener('click', () => {
                if (document.body.classList.contains('photo-lightbox-active')) return;
                requestPhotoSpotlightOpen(trackObj, item, { centerInTrack: true });
            });
        });
    }

    function bindStaticPhotoGalleries() {
        document.querySelectorAll('.photo-gallery-track').forEach((gallery, index) => {
            const galleryId = gallery.id || `photo-gallery-${index + 1}`;
            gallery.id = galleryId;

            let trackObj = state.trackMap.get(galleryId);
            const items = Array.from(gallery.querySelectorAll('.photo-item'));

            if (!trackObj) {
                trackObj = {
                    id: galleryId,
                    element: gallery,
                    items,
                    hScrollAnim: null,
                    controlsFocus: 0,
                    controlsFocusTarget: 0,
                    introTimer: null,
                    photoRestoreTimer: null,
                    staticGallery: true
                };
                state.trackMap.set(galleryId, trackObj);
            } else {
                trackObj.element = gallery;
                trackObj.items = items;
                trackObj.staticGallery = true;
            }

            items.forEach(item => {
                if (item.dataset.galleryBound === 'true') return;

                item.dataset.galleryBound = 'true';
                item.addEventListener('click', () => {
                    if (document.body.classList.contains('photo-lightbox-active')) return;
                    requestPhotoSpotlightOpen(trackObj, item);
                });
            });
        });
    }

    function getOrCreateTrack(trackId) {
        const trackEl = document.getElementById(trackId);
        if (!trackEl) return null;

        let trackObj = state.trackMap.get(trackId);
        const items = Array.from(trackEl.querySelectorAll('.dock-item'));

        if (!trackObj) {
            trackObj = {
                id: trackId,
                element: trackEl,
                items,
                hScrollAnim: null,
                controlsFocus: 0,
                controlsFocusTarget: 0,
                introTimer: null,
                photoRestoreTimer: null,
                expandHintItem: null
            };
            state.trackMap.set(trackId, trackObj);
            state.tracks.push(trackObj);
        } else {
            trackObj.element = trackEl;
            trackObj.items = items;
            trackObj.controlsFocus = trackObj.controlsFocus || 0;
            trackObj.controlsFocusTarget = trackObj.controlsFocusTarget || 0;
            trackObj.introTimer = trackObj.introTimer || null;
            trackObj.photoRestoreTimer = trackObj.photoRestoreTimer || null;
            trackObj.expandHintItem = trackObj.expandHintItem || null;
        }

        bindTrackItems(trackObj);
        ensureTrackControls(trackObj);
        return trackObj;
    }

    function startPhysics() {
        if (state.engineRunning) return;

        state.engineRunning = true;
        state.lastPhysicsTime = performance.now();
        state.physicsFrame = requestAnimationFrame(physicsLoop);
    }

    function stopPhysics() {
        state.engineRunning = false;
        state.autoScrollSpeed = 0;
        clearPhotoSpotlight();

        if (state.physicsFrame) {
            cancelAnimationFrame(state.physicsFrame);
            state.physicsFrame = null;
        }

        state.tracks.forEach(trackObj => {
            const section = trackObj.element.closest('.expansion-section, .level-2');
            if (!section || !section.classList.contains('active')) {
                resetTrackItems(trackObj);
            }
        });
    }

    function initCarousel(trackId) {
        const trackObj = getOrCreateTrack(trackId);
        if (!trackObj || trackObj.items.length === 0) return;

        const trackEl = trackObj.element;
        const mainStart = document.getElementById(trackId + '-main-start');
        const anchorItem = mainStart || trackObj.items[0];
        const targetLeft = getTrackCenterTarget(trackEl, anchorItem);

        state.targetFocalX = window.innerWidth / 2;
        state.currentFocalX = window.innerWidth / 2;
        prepareCarouselIntroStagger(trackObj, anchorItem);
        markCarouselIntro(trackObj);
        restartStagger(trackEl);

        if (trackEl.scrollWidth > trackEl.clientWidth + 2) {
            const introOffset = Math.min(420, trackEl.clientWidth * 0.36);
            trackEl.scrollLeft = clamp(targetLeft + introOffset, 0, trackEl.scrollWidth - trackEl.clientWidth);
            horizontalSpringTo(trackObj, targetLeft, MOTION.carouselIntro);
        }

        startPhysics();
        requestAnimationFrame(() => updateTrackItems(trackObj));
    }

    function playActiveTrackExit(sections) {
        sections.forEach(section => {
            section.querySelectorAll('.dock-carousel-track').forEach(trackEl => {
                const trackObj = state.trackMap.get(trackEl.id);
                if (!trackObj || trackEl.scrollWidth <= trackEl.clientWidth) return;

                const retreat = Math.min(520, trackEl.clientWidth * 0.38);
                horizontalSpringTo(trackObj, trackEl.scrollLeft - retreat, MOTION.sectionExit);
            });
        });
    }

    function hideSections(sections) {
        sections.forEach(section => {
            section.style.display = 'none';
            section.classList.remove('active', 'exit-right');
            section.setAttribute('aria-hidden', 'true');
        });
    }

    function openSection(section, trackId) {
        const trackEl = trackId ? document.getElementById(trackId) : null;
        const isPhotoCarousel = trackEl?.classList.contains('photo-carousel-track');
        const warmPromise = isPhotoCarousel ? warmPhotoTrack(trackEl) : Promise.resolve();

        section.classList.toggle('carousel-loading', Boolean(isPhotoCarousel));
        section.style.display = 'block';
        section.classList.remove('exit-right');
        section.setAttribute('aria-hidden', 'false');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                section.classList.add('active');
                const presentedScrollY = getSectionTop(section);
                markSectionPresentedScroll(section, presentedScrollY);
                scrollToSection(presentedScrollY);

                if (trackId) {
                    const openDelay = canAnimate() ? MOTION.sectionOpenDelay : 0;
                    const maxWarmWait = canAnimate() && isPhotoCarousel
                        ? Math.max(0, Number(trackEl.dataset.carouselWarmWait || 360))
                        : 0;
                    const delayPromise = new Promise(resolve => setTimeout(resolve, openDelay));
                    const boundedWarmPromise = isPhotoCarousel
                        ? Promise.race([
                            warmPromise,
                            new Promise(resolve => setTimeout(resolve, maxWarmWait))
                        ])
                        : Promise.resolve();

                    Promise.all([delayPromise, boundedWarmPromise]).then(() => {
                        if (section.style.display === 'none' || !section.classList.contains('active')) return;
                        section.classList.remove('carousel-loading');
                        initCarousel(trackId);
                    });
                } else {
                    section.classList.remove('carousel-loading');
                    stopPhysics();
                }
            });
        });
    }

    function transitionToSection(targetSection, trackId, selector) {
        if (!targetSection || state.sectionBusy) return;

        if (targetSection.classList.contains('active')) {
            const presentedScrollY = getSectionTop(targetSection);
            markSectionPresentedScroll(targetSection, presentedScrollY);
            scrollToSection(presentedScrollY);
            return;
        }

        const activeSections = getUniqueSections(selector);

        if (activeSections.length === 0) {
            openSection(targetSection, trackId);
            return;
        }

        state.sectionBusy = true;
        playActiveTrackExit(activeSections);

        activeSections.forEach(section => {
            section.classList.remove('active');
            section.classList.add('exit-right');
        });

        setTimeout(() => {
            hideSections(activeSections);
            stopPhysics();
            openSection(targetSection, trackId);
            state.sectionBusy = false;
        }, canAnimate() ? MOTION.sectionExit : 0);
    }

    function toggleMainSection(sectionId, trackId) {
        transitionToSection(
            document.getElementById(sectionId),
            trackId,
            '.expansion-section.active, .level-2.active'
        );
    }

    function toggleSubSection(sectionId, trackId) {
        transitionToSection(
            document.getElementById(sectionId),
            trackId,
            '.level-2.active'
        );
    }

    function animateCardReturn(selector) {
        const cards = Array.from(document.querySelectorAll(selector));

        if (!canAnimate()) return;

        cards.forEach((card, index) => {
            card.style.transition = 'none';
            card.style.transform = 'translate3d(0, 38px, 0)';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    card.style.transition = `transform ${MOTION.cardReturn}ms ${EASE.spring} ${index * MOTION.cardStagger}ms`;
                    card.style.transform = '';

                    setTimeout(() => {
                        card.style.transition = '';
                    }, MOTION.cardReturn + (index * MOTION.cardStagger));
                });
            });
        });
    }

    function animateTextReturn(selector) {
        if (!canAnimate()) return;

        const textItems = Array.from(document.querySelectorAll(selector));

        textItems.forEach((item, index) => {
            item.style.transition = 'none';
            item.style.transform = 'translate3d(0, 24px, 0)';
            item.style.opacity = index === 0 ? '0.82' : '0.58';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const delay = index * 55;
                    item.style.transition = `transform 560ms ${EASE.spring} ${delay}ms, opacity 360ms ease ${delay}ms`;
                    item.style.transform = '';
                    item.style.opacity = '';

                    setTimeout(() => {
                        item.style.transition = '';
                    }, 620 + delay);
                });
            });
        });
    }

    function closeAllSections() {
        if (state.sectionBusy) return;

        const activeSections = getUniqueSections('.expansion-section.active, .level-2.active');

        if (activeSections.length === 0) {
            scrollToSection(0);
            return;
        }

        state.sectionBusy = true;
        playActiveTrackExit(activeSections);

        activeSections.forEach(section => {
            section.classList.remove('active');
            section.classList.add('exit-right');
        });

        scrollToSection(0);
        animateTextReturn('#subpage-hero h1, #subpage-hero p');
        animateCardReturn('#category-grid .portfolio-item');

        setTimeout(() => {
            hideSections(activeSections);
            stopPhysics();
            state.sectionBusy = false;
        }, canAnimate() ? MOTION.sectionExit : 0);
    }

    function closeLevel2() {
        if (state.sectionBusy) return;

        const activeLevel2 = getUniqueSections('.level-2.active');
        if (activeLevel2.length === 0) return;

        state.sectionBusy = true;
        playActiveTrackExit(activeLevel2);

        activeLevel2.forEach(section => {
            section.classList.remove('active');
            section.classList.add('exit-right');
        });

        const parentSection = document.querySelector('.level-1.active');
        if (parentSection) {
            const presentedScrollY = getSectionTop(parentSection);
            markSectionPresentedScroll(parentSection, presentedScrollY);
            scrollToSection(presentedScrollY);

            if (parentSection.id) {
                animateTextReturn(`#${parentSection.id} .section-back-btn`);
                animateTextReturn(`#${parentSection.id} .carousel-section-title`);
                animateCardReturn(`#${parentSection.id} .portfolio-item`);
            }
        }

        setTimeout(() => {
            hideSections(activeLevel2);
            stopPhysics();
            state.sectionBusy = false;
        }, canAnimate() ? MOTION.sectionExit : 0);
    }

    function isTrackVisible(trackObj) {
        const section = trackObj.element.closest('.expansion-section, .level-2');
        return !section || section.classList.contains('active');
    }

    function syncCenteredPhotoOrientation(trackObj, centeredItem) {
        const section = trackObj?.element?.closest('.carousel-view-container');
        if (!section) return;

        const isCenteredLandscape = Boolean(
            centeredItem?.classList?.contains('photo-landscape')
            && trackObj.element.classList.contains('photo-carousel-track')
        );
        section.classList.toggle('is-centered-landscape', isCenteredLandscape);
    }

    function writeItemMotion(item, transform, opacity, zIndex) {
        const last = item.__portfolioMotion || {};

        if (last.transform !== transform) {
            item.style.transform = transform;
            last.transform = transform;
        }

        if (last.opacity !== opacity) {
            item.style.opacity = opacity;
            last.opacity = opacity;
        }

        if (last.zIndex !== zIndex) {
            item.style.zIndex = zIndex;
            last.zIndex = zIndex;
        }

        item.__portfolioMotion = last;
    }

    function updateTrackItems(trackObj) {
        const trackEl = trackObj.element;
        const trackRect = trackEl.getBoundingClientRect();
        const focalX = trackEl.scrollLeft + (state.currentFocalX - trackRect.left);
        const radius = window.innerWidth < 700 ? 270 : 380;
        const spread = radius / 2.45;
        const controlsFocus = trackObj.controlsFocus || 0;
        const now = performance.now();
        const photoSpotlightActive = document.body.classList.contains('photo-lightbox-active')
            && trackObj.element.classList.contains('photo-carousel-track');
        const photoSpotlightRecovering = now < state.photoSpotlightRecoverUntil
            && trackObj.element.classList.contains('photo-carousel-track');
        const recoverDuration = Math.max(1, state.photoSpotlightRecoverUntil - state.photoSpotlightRecoverStartedAt);
        const recoverProgress = photoSpotlightRecovering
            ? clamp((now - state.photoSpotlightRecoverStartedAt) / recoverDuration, 0, 1)
            : 1;
        const recoverEase = 1 - Math.pow(1 - recoverProgress, 3);
        const showExpandHint = trackObj.element.classList.contains('photo-carousel-track')
            && !photoSpotlightActive
            && !photoSpotlightRecovering;
        let hintItem = null;
        let hintDistance = Infinity;

        trackObj.items.forEach(item => {
            if (photoSpotlightActive) {
                item.classList.remove('photo-expand-hint');
                writeItemMotion(
                    item,
                    'scale3d(1, 1, 1)',
                    '1',
                    item.classList.contains('is-photo-spotlight') ? '220' : ''
                );
                return;
            }

            const itemCenterX = item.offsetLeft + (item.offsetWidth / 2);
            const distance = Math.abs(focalX - itemCenterX);
            const isPhotoItem = item.classList.contains('photo-item');
            const naturalEffect = Math.exp(-(distance * distance) / (2 * spread * spread));
            const effect = naturalEffect;

            if (showExpandHint && isPhotoItem && distance < hintDistance) {
                hintDistance = distance;
                hintItem = item;
            }

            const isSpotlightItem = item.classList.contains('is-photo-spotlight');
            const maxScaleBoost = isPhotoItem
                ? (item.classList.contains('photo-portrait')
                    ? (isSpotlightItem ? 0.42 : 0.3)
                    : (isSpotlightItem ? 0.28 : 0.22))
                : 0.46;
            const scaleVal = 1 + (maxScaleBoost * effect);
            const opacityVal = 0.38 + (0.62 * effect);
            const relaxedScale = scaleVal + ((1 - scaleVal) * controlsFocus);
            const relaxedOpacity = opacityVal + ((0.72 - opacityVal) * controlsFocus);
            const settledScale = photoSpotlightRecovering
                ? 1 + ((relaxedScale - 1) * recoverEase)
                : relaxedScale;
            const settledOpacity = photoSpotlightRecovering
                ? 1 + ((relaxedOpacity - 1) * recoverEase)
                : relaxedOpacity;

            const scaleText = settledScale.toFixed(4);
            writeItemMotion(
                item,
                `scale3d(${scaleText}, ${scaleText}, 1)`,
                settledOpacity.toFixed(4),
                isSpotlightItem ? '220' : String(Math.round(effect * 100))
            );
        });

        if (showExpandHint) {
            syncCenteredPhotoOrientation(trackObj, hintItem);
            setPhotoExpandHint(trackObj, hintItem);
        } else {
            syncCenteredPhotoOrientation(trackObj, null);
            setPhotoExpandHint(trackObj, null);
        }
    }

    function physicsLoop(currentTime) {
        if (!state.engineRunning) return;

        const dt = Math.min(currentTime - state.lastPhysicsTime, 48);
        state.lastPhysicsTime = currentTime;

        const timeScale = dt / 16.666;
        const lerpFactor = 1 - Math.pow(1 - 0.12, timeScale);
        state.currentFocalX += (state.targetFocalX - state.currentFocalX) * lerpFactor;

        state.tracks.forEach(trackObj => {
            if (!isTrackVisible(trackObj)) return;

            if (state.autoScrollSpeed !== 0 && !trackObj.hScrollAnim) {
                trackObj.element.scrollLeft += state.autoScrollSpeed * timeScale;
            }

            if (typeof trackObj.controlsFocus === 'number') {
                const focusTarget = trackObj.controlsFocusTarget || 0;
                const focusLerp = 1 - Math.pow(1 - 0.18, timeScale);
                trackObj.controlsFocus += (focusTarget - trackObj.controlsFocus) * focusLerp;

                if (Math.abs(trackObj.controlsFocus - focusTarget) < 0.001) {
                    trackObj.controlsFocus = focusTarget;
                }
            }

            const scrollLeft = trackObj.element.scrollLeft;
            const photoStateActive = document.body.classList.contains('photo-lightbox-active')
                || currentTime < state.photoSpotlightRecoverUntil;
            const needsRender = trackObj.hScrollAnim
                || state.autoScrollSpeed !== 0
                || photoStateActive
                || trackObj.lastRenderedPhotoStateActive !== photoStateActive
                || Math.abs(scrollLeft - (trackObj.lastRenderedScrollLeft ?? -Infinity)) > 0.2
                || Math.abs(state.currentFocalX - (trackObj.lastRenderedFocalX ?? -Infinity)) > 0.2
                || Math.abs((trackObj.controlsFocus || 0) - (trackObj.lastRenderedControlsFocus ?? -Infinity)) > 0.002;

            if (needsRender) {
                updateTrackItems(trackObj);
                trackObj.lastRenderedScrollLeft = scrollLeft;
                trackObj.lastRenderedFocalX = state.currentFocalX;
                trackObj.lastRenderedControlsFocus = trackObj.controlsFocus || 0;
                trackObj.lastRenderedPhotoStateActive = photoStateActive;
            }
        });

        state.physicsFrame = requestAnimationFrame(physicsLoop);
    }

    function updatePointerFocus(clientX) {
        state.targetFocalX = clientX;
        state.autoScrollSpeed = 0;
    }

    function setPhotoExpandHint(trackObj, hintItem) {
        const previousHintItem = trackObj.expandHintItem || null;

        if (previousHintItem === hintItem) return;

        if (previousHintItem) {
            previousHintItem.classList.remove('photo-expand-hint');
            previousHintItem.classList.add('photo-expand-hint-exit');
            setTimeout(() => {
                previousHintItem.classList.remove('photo-expand-hint-exit');
            }, 280);
        }

        trackObj.expandHintItem = hintItem || null;

        if (hintItem) {
            hintItem.classList.remove('photo-expand-hint-exit');
            hintItem.classList.remove('photo-expand-hint');
            void hintItem.offsetWidth;
            hintItem.classList.add('photo-expand-hint');
        }
    }

    function isMainPage() {
        const page = window.location.pathname.split('/').pop().toLowerCase();
        return page === '' || page === MAIN_PAGE_URL || page === 'photography.html';
    }

    function isMainPageUrl(url) {
        const page = new URL(url, window.location.href).pathname.split('/').pop().toLowerCase();
        return page === '' || page === MAIN_PAGE_URL || page === 'photography.html';
    }

    function markMainNavReturn() {
        try {
            sessionStorage.setItem(MAIN_NAV_RETURN_KEY, 'true');
        } catch (error) {
            // Session storage can be unavailable in stricter browser modes.
        }
    }

    function consumeMainNavReturn() {
        if (!isMainPage()) return false;

        try {
            const shouldAnimate = sessionStorage.getItem(MAIN_NAV_RETURN_KEY) === 'true';
            sessionStorage.removeItem(MAIN_NAV_RETURN_KEY);
            return shouldAnimate;
        } catch (error) {
            return false;
        }
    }

    function getTouchedScrollable(x, y) {
        const hoveredElement = document.elementFromPoint(x, y);
        return hoveredElement ? hoveredElement.closest('.horizontal-scroll-row, .dock-carousel-track') : null;
    }

    function triggerReturnToMainPage() {
        if (state.isNavigating || isMainPage()) return;
        state.isNavigating = true;
        markMainNavReturn();
        document.body.classList.add('exit-right', 'main-nav-exit');
        setTimeout(() => {
            window.location.href = MAIN_PAGE_URL;
        }, canAnimate() ? MOTION.pageExit : 0);
    }

    function shouldAnimateLink(link, event) {
        if (!link || state.isNavigating) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return false;
        if (link.target && link.target !== '_self') return false;

        const href = link.getAttribute('href');
        if (!href || href === '#' || href.startsWith('#') || href.startsWith('javascript:')) return false;

        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return false;
        if (url.href === window.location.href) return false;

        return true;
    }

    function navigateWithExit(url) {
        state.isNavigating = true;
        if (isMainPageUrl(url)) {
            markMainNavReturn();
        }
        document.body.classList.add('exit-right');

        setTimeout(() => {
            window.location.href = url;
        }, canAnimate() ? MOTION.pageExit : 0);
    }

    function restoreVisiblePageState() {
        state.isNavigating = false;
        state.photoSpotlightOpenPending = false;
        state.lastPhysicsTime = performance.now();
        document.body.classList.add('page-restored');
        document.body.classList.remove('fade-out', 'exit-right', 'main-nav-exit');

        const pageContent = document.getElementById('page-content');
        pageContent?.getAnimations?.().forEach(animation => {
            if (animation.effect?.target === pageContent) {
                animation.cancel();
            }
        });

        if (document.body.classList.contains('main-nav-return')) {
            document.body.classList.add('main-nav-return-ready');
        }
    }

    function isHistoryRestore(event) {
        const navigationEntry = performance.getEntriesByType?.('navigation')?.[0];
        return Boolean(event.persisted || navigationEntry?.type === 'back_forward');
    }

    document.body.classList.toggle('has-main-link', Boolean(document.querySelector('.header-nav .back-btn')));
    document.body.classList.toggle('main-nav-return', consumeMainNavReturn());

    document.addEventListener('DOMContentLoaded', () => {
        bindStaticPhotoGalleries();
        scheduleSafariPhotoWarmup();

        requestAnimationFrame(() => {
            setTimeout(() => {
                document.body.classList.remove('fade-out');
                if (document.body.classList.contains('main-nav-return')) {
                    requestAnimationFrame(() => {
                        document.body.classList.add('main-nav-return-ready');
                    });
                }
            }, 20);
        });
    });

    window.addEventListener('pageshow', event => {
        if (isHistoryRestore(event)) {
            restoreVisiblePageState();
        } else {
            state.isNavigating = false;
        }
    });

    window.addEventListener('pagehide', () => {
        state.isNavigating = false;
        state.photoSpotlightOpenPending = false;
        document.body.classList.remove('fade-out', 'exit-right', 'main-nav-exit');
    });

    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!shouldAnimateLink(link, event)) return;

        event.preventDefault();
        navigateWithExit(link.href);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            clearPhotoSpotlight();
        }
    });

    window.addEventListener('pointermove', event => {
        if (!state.engineRunning || event.pointerType === 'touch' || document.body.classList.contains('photo-lightbox-active')) return;
        if (performance.now() < state.photoSpotlightRecoverUntil) return;
        if (event.target.closest?.('.carousel-nav-button')) return;
        updatePointerFocus(event.clientX);
    });

    window.addEventListener('pointerleave', () => {
        state.targetFocalX = window.innerWidth / 2;
        state.autoScrollSpeed = 0;
    });

    window.addEventListener('wheel', event => {
        if (isMainPage() || state.isNavigating) return;
        if (event.deltaX > -45 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.2) return;

        const scrollableContainer = getTouchedScrollable(event.clientX, event.clientY);
        if ((scrollableContainer && scrollableContainer.scrollLeft <= 2) || !scrollableContainer) {
            triggerReturnToMainPage();
        }
    }, { passive: true });

    window.addEventListener('touchstart', event => {
        const touch = event.touches[0];
        state.touchStartX = touch.clientX;
        state.touchStartY = touch.clientY;
    }, { passive: true });

    window.addEventListener('touchmove', event => {
        if (isMainPage() || state.isNavigating) return;

        const touch = event.touches[0];
        const deltaX = touch.clientX - state.touchStartX;
        const deltaY = Math.abs(touch.clientY - state.touchStartY);

        if (deltaX <= 80 || deltaY > 42) return;

        const scrollableContainer = getTouchedScrollable(touch.clientX, touch.clientY);
        if ((scrollableContainer && scrollableContainer.scrollLeft <= 2) || !scrollableContainer) {
            triggerReturnToMainPage();
        }
    }, { passive: true });

    window.addEventListener('resize', () => {
        state.targetFocalX = window.innerWidth / 2;
        state.currentFocalX = window.innerWidth / 2;

        if (state.photoSpotlightOverlay && state.photoSpotlightItem && document.body.classList.contains('photo-lightbox-active')) {
            const image = state.photoSpotlightItem.querySelector('img');
            if (image) {
                const finalRect = getPhotoFinalRect(state.photoSpotlightItem, image);
                const metrics = getStoredPhotoBaseMetrics(state.photoSpotlightItem, image, finalRect);
                setPhotoGeometryVars(state.photoSpotlightOverlay, 'final', finalRect, metrics);
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        state.lastPhysicsTime = performance.now();
    });

    window.activeTracks = state.tracks;
    window.closeAllSections = closeAllSections;
    window.closeLevel2 = closeLevel2;
    window.beginPhotoCarouselRecover = beginPhotoCarouselRecover;
    window.horizontalSpringTo = horizontalSpringTo;
    window.initCarousel = initCarousel;
    window.scrollToSection = scrollToSection;
    window.stopPhysics = stopPhysics;
    window.toggleMainSection = toggleMainSection;
    window.toggleSubSection = toggleSubSection;
})();
