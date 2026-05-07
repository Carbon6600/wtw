// 🔥 FIREBASE CONFIG
        const firebaseConfig = {
            apiKey: "AIzaSyA2GhEQaR1aEZ_5R0WOOQL4rIoLUX6Zn-M",
            authDomain: "syncview-app.firebaseapp.com",
            databaseURL: "https://syncview-app-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "syncview-app",
            storageBucket: "syncview-app.appspot.com",
            messagingSenderId: "994652416180",
            appId: "1:994652416180:web:e12eff40f22b273288cfe1"
        };

        // Ініціалізація
        let database, auth, currentUser = null;

        try {
            firebase.initializeApp(firebaseConfig);
            database = firebase.database();
            auth = firebase.auth();
            
            auth.signInAnonymously()
                .then((userCredential) => {
                    currentUser = userCredential.user;
                    console.log('✅ Авторизовано анонімно:', currentUser.uid);
                    hideLoading();
                })
                .catch((error) => {
                    console.error('❌ Помилка авторизації:', error);
                    showLoadingError('Помилка автентифікації: ' + error.message);
                });
                
        } catch (error) {
            console.error('❌ Помилка Firebase:', error);
            showLoadingError('Помилка підключення до бази даних.');
        }

        // 🎲 МИЛІ НІКНЕЙМИ
        const cuteAdjectives = ['Милий', 'Солодкий', 'Пухнастий', 'Яскравий', 'Веселий', 'Сонячний', 'Місячний', 'Зоряний', 'Радісний', 'Щасливий'];
        const cuteNouns = ['Їжачок', 'Котик', 'Песик', 'Зайчик', 'Ведмедик', 'Пандочка', 'Лисичка', 'Слоник', 'Пінгвінчик', 'Капібара'];
        const cuteEmojis = ['🦔', '🐱', '🐶', '🐰', '🐻', '🐼', '🦊', '🐘', '🐧', '🦫'];

        function generateCuteNickname() {
            const adj = cuteAdjectives[Math.floor(Math.random() * cuteAdjectives.length)];
            const noun = cuteNouns[Math.floor(Math.random() * cuteNouns.length)];
            const emoji = cuteEmojis[Math.floor(Math.random() * cuteEmojis.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            return `${adj}${noun}${num} ${emoji}`;
        }

        // Глобальні змінні
        let currentRoom = null, userId = null, userName = '', isHost = false;
        let roomRef = null, player = null, videoType = 'html5';
        let isSyncing = false, lastSyncTime = 0;
        let replyTo = null, usersList = {};
        let localStream = null, isStreaming = false;
        
        // Змінні для iframe синхронізації
        let syncInterval = null;
        let lastIframeTime = 0;
        let isSeeking = false;
        let iframeChecker = null;
        let currentIframe = null;
        let markersList = [];

        // Змінні для PlayerJS
        let playerjsInstance = null;
        let playerjsSyncInterval = null;
        let playerjsLastTime = 0;
        let playerjsHlsInstance = null;
        let playerjsDesiredQuality = "auto";
        let suppressQualityBroadcast = false;
        let extractedSources = [];

        function generateId() { return Math.random().toString(36).substr(2, 9); }
        function generateRoomCode() { return Math.random().toString(36).substr(2, 6).toUpperCase(); }

        function showLoading() {
            document.getElementById('loadingOverlay').classList.remove('hidden');
        }

        function hideLoading() {
            document.getElementById('loadingOverlay').classList.add('hidden');
        }

        function showLoadingError(message) {
            const errorDiv = document.getElementById('loadingError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            document.querySelector('.spinner').style.display = 'none';
        }

        function createRoom() {
            if (!currentUser) {
                showNotification('❌ Помилка: Не авторизовано', 'error');
                return;
            }
            
            currentRoom = generateRoomCode();
            userId = currentUser.uid;
            userName = generateCuteNickname();
            isHost = true;
            
            document.getElementById('homePage').style.display = 'none';
            document.getElementById('roomPage').style.display = 'block';
            document.getElementById('roomCodeDisplay').textContent = currentRoom;
            
            setTimeout(() => {
                const qrContainer = document.getElementById('qrcode');
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: `${window.location.origin}${window.location.pathname}?room=${currentRoom}`,
                    width: 150, height: 150
                });
            }, 100);
            
            initRoom();
            showNotification(`✅ Кімнату створено! Ви — ${userName}`);
        }

        function showJoin() {
            document.getElementById('homePage').style.display = 'none';
            document.getElementById('joinPage').style.display = 'block';
        }

        function showHome() {
            document.getElementById('joinPage').style.display = 'none';
            document.getElementById('homePage').style.display = 'block';
        }

        function joinRoom() {
            if (!currentUser) {
                showNotification('❌ Помилка: Не авторизовано', 'error');
                return;
            }
            
            const code = document.getElementById('joinCode').value.toUpperCase().trim();
            const nameInput = document.getElementById('userNameJoin').value.trim();
            
            if (code.length !== 6) {
                showNotification('❌ Введіть коректний код (6 символів)', 'error');
                return;
            }
            
            currentRoom = code;
            userId = currentUser.uid;
            userName = nameInput || generateCuteNickname();
            isHost = false;
            
            document.getElementById('joinPage').style.display = 'none';
            document.getElementById('roomPage').style.display = 'block';
            document.getElementById('roomCodeDisplay').textContent = currentRoom;
            
            setTimeout(() => {
                const qrContainer = document.getElementById('qrcode');
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: `${window.location.origin}${window.location.pathname}?room=${currentRoom}`,
                    width: 150, height: 150
                });
            }, 100);
            
            initRoom();
            showNotification(`🎉 Ви приєдналися! Ви — ${userName}`);
        }

        function initRoom() {
            roomRef = database.ref('rooms/' + currentRoom);
            const userRef = roomRef.child('users/' + userId);
            
            userRef.set({
                name: userName,
                isHost: isHost,
                joinedAt: firebase.database.ServerValue.TIMESTAMP,
                lastSeen: firebase.database.ServerValue.TIMESTAMP
            }).catch(error => {
                console.error('Помилка запису в Firebase:', error);
                showNotification('❌ Помилка з\'єднання з кімнатою', 'error');
            });
            
            userRef.onDisconnect().remove();
            
            setInterval(() => {
                userRef.update({ lastSeen: firebase.database.ServerValue.TIMESTAMP })
                    .catch(err => console.log('Помилка оновлення статусу:', err));
            }, 5000);
            
            listenToRoom();
        }

        function listenToRoom() {
            roomRef.child('users').on('value', (snapshot) => {
                usersList = snapshot.val() || {};
                updateUserList(usersList);
            });
            
            roomRef.child('video').on('value', (snapshot) => {
                const videoState = snapshot.val();
                if (videoState && videoState.updatedBy !== userId) {
                    syncVideoState(videoState);
                }
            });
            
            roomRef.child('chat').limitToLast(50).on('child_added', (snapshot) => {
                const msg = snapshot.val();
                if (msg && msg.userId !== userId) {
                    displayMessage(msg);
                }
            });
            
            roomRef.child('markers').on('value', (snapshot) => {
                const markers = snapshot.val();
                if (markers) {
                    markersList = Object.entries(markers).map(([id, data]) => ({ id, ...data }));
                    updateMarkersBar();
                }
            });
            
            roomRef.child('stream').on('value', (snapshot) => {
                const streamData = snapshot.val();
                handleStreamUpdate(streamData);
            });
        }

        function updateUserList(users) {
            const list = document.getElementById('userList');
            list.innerHTML = '';
            let count = 0;
            
            Object.entries(users).forEach(([uid, user]) => {
                count++;
                const badge = document.createElement('div');
                badge.className = 'user-badge';
                if (user.isHost) badge.classList.add('host');
                if (uid === userId) badge.classList.add('me');
                
                badge.innerHTML = `${user.isHost ? '👑' : '👤'} ${user.name}`;
                badge.onclick = () => mentionUser(user.name);
                
                list.appendChild(badge);
            });
            
            document.getElementById('userCount').textContent = count;
        }

        function setVideoType(type) {
            videoType = type;
            document.querySelectorAll('.btn-type').forEach(btn => btn.classList.remove('active'));
            document.getElementById('btn-' + type).classList.add('active');
            
            const infoBox = document.getElementById('videoInfoBox');
            const urlGroup = document.getElementById('urlInputGroup');
            const videoControls = document.getElementById('videoControls');
            const superControls = document.getElementById('superControls');
            const streamControls = document.getElementById('streamControls');
            const limitedControls = document.getElementById('limitedControls');
            const playerjsControls = document.getElementById('playerjsControls');
            const streamOverlay = document.getElementById('streamOverlay');
            const markersBar = document.getElementById('markersBar');
            const legalGuardrailBox = document.getElementById('legalGuardrailBox');
            const legalConsentCheckbox = document.getElementById('legalConsentCheckbox');
            const extractSourceTabs = document.getElementById('extractSourceTabs');
            
            // Скидаємо все
            videoControls.style.display = 'none';
            superControls.style.display = 'none';
            streamControls.style.display = 'none';
            limitedControls.style.display = 'none';
            playerjsControls.style.display = 'none';
            streamOverlay.classList.add('hidden');
            markersBar.style.display = 'none';
            urlGroup.style.display = 'flex';
            legalGuardrailBox.style.display = 'none';
            extractSourceTabs.style.display = 'none';
            
            if (type === 'html5') {
                infoBox.innerHTML = '💡 <strong>MP4/WebM/M3U8:</strong> Прямі посилання на відеофайли. Повна синхронізація!';
                videoControls.style.display = 'flex';
            } 
            else if (type === 'youtube') {
                infoBox.innerHTML = '📺 <strong>YouTube:</strong> Вставте посилання на YouTube відео. Обмежена синхронізація.';
                limitedControls.style.display = 'flex';
                document.getElementById('videoUrl').placeholder = 'https://youtube.com/watch?v=...';
            }
            else if (type === 'site-extract') {
                infoBox.innerHTML = '🔎 <strong>Сайт → відео (через бекенд):</strong> Вставте URL сторінки з фільмом. Сервер спробує знайти прямий MP4/M3U8 і запустити його тут.';
                infoBox.classList.add('super-info');
                videoControls.style.display = 'flex';
                document.getElementById('videoUrl').placeholder = 'https://uakino.best/filmy/...';
                legalGuardrailBox.style.display = 'block';
                if (!legalConsentCheckbox.checked) {
                    updateSyncStatus('⚖️ Потрібне юридичне підтвердження перед екстракцією', 'warning');
                }
            }
            else if (type === 'iframe') {
                infoBox.innerHTML = '🌐 <strong>Звичайний IFrame:</strong> Просто вбудовуємо сайт. Без синхронізації.';
                limitedControls.style.display = 'flex';
                document.getElementById('videoUrl').placeholder = 'https://example.com';
            }
            else if (type === 'iframe-sync') {
                infoBox.innerHTML = '🌟 <strong>СУПЕР-СИНХРОНІЗАЦІЯ IFRAME:</strong> Спеціальний режим з маркерами часу! Хост може створювати маркери, всі бачать поточний час.';
                infoBox.classList.add('super-info');
                videoControls.style.display = 'flex';
                superControls.style.display = 'flex';
                markersBar.style.display = 'flex';
                document.getElementById('videoUrl').placeholder = 'https://uakino.best/cartoon/... або інший сайт';
            }
            else if (type === 'stream') {
                infoBox.innerHTML = '📡 <strong>Стрім екрану:</strong> Хост ділиться екраном через WebRTC.';
                urlGroup.style.display = 'none';
                streamOverlay.classList.remove('hidden');
                checkActiveStream();
            }
            else if (type === 'playerjs') {
                infoBox.innerHTML = '🎯 <strong>PlayerJS HLS:</strong> Відтворення HLS потоків з повною синхронізацією!';
                infoBox.classList.add('super-info');
                playerjsControls.style.display = 'flex';
                document.getElementById('videoUrl').placeholder = 'https://ashdi.vip/video15/2/new/zootopia.2.2025.1080p.it.webdl.dd5.1.h.264spilno_232851/hls/1080/BKaKlHaPlvtanhH+BQ==/index.m3u8 або інший HLS потік';
            }
            
            // Скидаємо плеєр
            document.getElementById('videoPlayer').innerHTML = '';
            if (syncInterval) clearInterval(syncInterval);
            if (iframeChecker) clearInterval(iframeChecker);
            if (playerjsSyncInterval) clearInterval(playerjsSyncInterval);
            if (playerjsInstance) playerjsInstance = null;
        }

        function loadVideo() {
            const url = document.getElementById('videoUrl').value.trim();
            if (!url) return;

            if (videoType === 'site-extract') {
                const legalConsentCheckbox = document.getElementById('legalConsentCheckbox');
                if (!legalConsentCheckbox.checked) {
                    showNotification('⚖️ Підтвердьте законне використання перед екстракцією', 'warning');
                    return;
                }
            }
            
            if (videoType === 'youtube') loadYouTube(url);
            else if (videoType === 'site-extract') extractSiteAndLoad(url);
            else if (videoType === 'iframe') loadIframe(url);
            else if (videoType === 'iframe-sync') loadIframeWithSync(url);
            else if (videoType === 'html5') loadHTML5(url);
            else if (videoType === 'playerjs') loadPlayerJS(url);
        }

        function choosePreferredExtractSource(sources) {
            if (!Array.isArray(sources) || sources.length === 0) return null;
            return sources.find(s => s.role === 'movie') || sources[0];
        }

        function renderExtractSourceTabs(sources, activeUrl) {
            const tabs = document.getElementById('extractSourceTabs');
            if (!Array.isArray(sources) || sources.length <= 1) {
                tabs.style.display = 'none';
                tabs.innerHTML = '';
                return;
            }

            const buttons = sources.map((source, index) => {
                const label = source.label || (source.role === 'trailer' ? 'Трейлер' : 'Фільм');
                const activeClass = source.url === activeUrl ? 'style="background: rgba(78, 205, 196, 0.25); border-color: #4ecdc4;"' : '';
                return `<button class="btn-secondary" ${activeClass} onclick="switchExtractSource(${index})">${label}</button>`;
            }).join('');

            tabs.innerHTML = `<span style="color:#bbb; margin-right:8px;">Джерело:</span>${buttons}`;
            tabs.style.display = 'flex';
        }

        function loadExtractedSource(source) {
            if (!source || !source.url) return;
            const directUrl = source.url;
            const kind = source.kind;

            document.getElementById('videoUrl').value = directUrl;
            renderExtractSourceTabs(extractedSources, directUrl);

            if (kind === 'm3u8') {
                setVideoType('playerjs');
                loadPlayerJS(directUrl);
            } else if (kind === 'mp4') {
                setVideoType('html5');
                loadHTML5(directUrl);
            } else {
                showNotification('⚠️ Прямого відео не знайдено — відкриваю плеєр/вбудовану сторінку', 'warning');
                setVideoType('iframe');
                loadIframe(directUrl);
            }
            renderExtractSourceTabs(extractedSources, directUrl);
        }

        function switchExtractSource(index) {
            const source = extractedSources[index];
            if (!source) return;
            loadExtractedSource(source);
            const label = source.label || (source.role === 'trailer' ? 'Трейлер' : 'Фільм');
            showNotification(`🎬 Перемкнено: ${label}`, 'success');
        }

        async function extractSiteAndLoad(pageUrl) {
            updateSyncStatus('🔎 Шукаю відео на сторінці...', 'syncing');
            const container = document.getElementById('videoPlayer');
            container.innerHTML = `
                <div class="info-box super-info" style="margin:0;">
                    ⏳ Витягую посилання на відео з сайту...<br>
                    <small style="color:#aaa;">Якщо сайт захищений (Cloudflare/anti-bot), витяг може не спрацювати.</small>
                </div>
            `;

            try {
                const res = await fetch('/api/extract', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-W2W-Legal-Ack': '1'
                    },
                    body: JSON.stringify({ url: pageUrl })
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`API ${res.status}: ${text}`);
                }

                const data = await res.json();
                const directUrl = data.directUrl;
                const kind = data.kind;
                const responseSources = Array.isArray(data.sources) ? data.sources : [];
                extractedSources = responseSources.length > 0
                    ? responseSources
                    : [{ url: directUrl, kind: kind || 'unknown', role: 'movie', label: 'Фільм' }];

                const preferred = choosePreferredExtractSource(extractedSources);
                if (!preferred || !preferred.url) throw new Error('Порожня відповідь від екстрактора');

                loadExtractedSource(preferred);

                addSystemMessage(`${userName} витягнув відео з сайту 🔎`);
            } catch (e) {
                console.error('extractSiteAndLoad error:', e);
                extractedSources = [];
                renderExtractSourceTabs([], '');
                updateSyncStatus('❌ Не вдалося витягнути відео', 'offline');
                showNotification('❌ Не вдалося витягнути відео з сайту. Спробуйте інший фільм або режим (стрім/iframe).', 'error');
            }
        }

        function clearVideo() {
            document.getElementById('videoPlayer').innerHTML = '';
            document.getElementById('videoUrl').value = '';
            extractedSources = [];
            renderExtractSourceTabs([], '');
            updateSyncStatus('Очікування відео...', 'success');
            
            if (roomRef) {
                roomRef.child('video').set({
                    type: 'none',
                    url: '',
                    updatedBy: userId,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                });
            }
            
            addSystemMessage(`${userName} очистив відео 🗑️`);
            
            if (playerjsInstance) {
                playerjsInstance = null;
            }
            if (playerjsHlsInstance) {
                playerjsHlsInstance.destroy();
                playerjsHlsInstance = null;
            }
            resetPlayerJSQualitySelector();
            if (playerjsSyncInterval) {
                clearInterval(playerjsSyncInterval);
                playerjsSyncInterval = null;
            }
        }

        function loadYouTube(url) {
            let videoId = '';
            if (url.includes('v=')) videoId = url.split('v=')[1].split('&')[0];
            else if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1].split('?')[0];
            
            if (!videoId) {
                showNotification('❌ Невірне посилання YouTube', 'error');
                return;
            }
            
            const container = document.getElementById('videoPlayer');
            container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?enablejsapi=1" frameborder="0" allowfullscreen></iframe>`;
            
            updateSyncStatus('YouTube (обмежена синхронізація)', 'warning');
            
            roomRef.child('video').set({
                type: 'youtube',
                videoId: videoId,
                url: url,
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            addSystemMessage(`${userName} завантажив YouTube відео 🎬`);
        }

        function loadIframe(url) {
            const container = document.getElementById('videoPlayer');
            container.innerHTML = `<iframe src="${url}" width="100%" height="100%" frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-presentation allow-forms"></iframe>`;
            
            updateSyncStatus('IFrame режим (синхронізація обмежена)', 'warning');
            
            roomRef.child('video').set({
                type: 'iframe',
                url: url,
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            addSystemMessage(`${userName} відкрив сайт у кімнаті 🌐`);
        }

        function loadHTML5(url) {
            const container = document.getElementById('videoPlayer');
            container.innerHTML = `<video id="html5Video" controls style="width:100%; height:100%;"></video>`;
            
            player = document.getElementById('html5Video');
            player.src = url;
            
            player.oncanplay = () => {
                updateSyncStatus('Відео готове ✅', 'success');
                updateTimeDisplay();
            };
            
            player.onplay = () => { if (!isSyncing) broadcastState(); };
            player.onpause = () => { if (!isSyncing) broadcastState(); };
            player.ontimeupdate = () => {
                updateTimeDisplay();
                const now = Date.now();
                if (now - lastSyncTime > 2000 && !player.paused) {
                    broadcastState();
                    lastSyncTime = now;
                }
            };
            
            roomRef.child('video').set({
                type: 'html5',
                url: url,
                currentTime: 0,
                isPlaying: false,
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            addSystemMessage(`${userName} завантажив відео 🎥`);
        }

        // ========== HLS/HTML5 ПЛЕЄР (без зовнішньої PlayerJS залежності) ==========
        function loadPlayerJS(url) {
            const container = document.getElementById('videoPlayer');
            
            if (playerjsHlsInstance) {
                playerjsHlsInstance.destroy();
                playerjsHlsInstance = null;
            }
            resetPlayerJSQualitySelector();
            
            // Створюємо контейнер для плеєра
            container.innerHTML = `
                <div id="playerjs-container" style="width: 100%; height: 100%;"></div>
            `;
            
            const playerContainer = document.getElementById('playerjs-container');
            
            try {
                // Перевіряємо чи це HLS потік
                if (url.includes('.m3u8')) {
                    // Використовуємо HLS.js для кращої підтримки
                    if (Hls.isSupported()) {
                        const video = document.createElement('video');
                        video.controls = true;
                        video.style.width = '100%';
                        video.style.height = '100%';
                        playerContainer.appendChild(video);
                        
                        const hls = new Hls();
                        playerjsHlsInstance = hls;
                        hls.loadSource(url);
                        hls.attachMedia(video);
                        
                        player = video;
                        
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            populatePlayerJSQualitySelector(hls);
                            video.play().catch(e => console.log('Autoplay blocked'));
                        });
                        
                        video.onplay = () => { if (!isSyncing) broadcastPlayerJSState(); };
                        video.onpause = () => { if (!isSyncing) broadcastPlayerJSState(); };
                        video.ontimeupdate = () => {
                            updatePlayerJSTimeDisplay();
                            const now = Date.now();
                            if (now - lastSyncTime > 2000 && !video.paused) {
                                broadcastPlayerJSState();
                                lastSyncTime = now;
                            }
                        };
                        
                        updateSyncStatus('HLS потік завантажено ✅', 'success');
                        addSystemMessage(`${userName} завантажив HLS потік через HLS.js 📡`);
                    } else {
                        // Fallback без PlayerJS: пробуємо нативний HTML5 плеєр
                        const video = document.createElement('video');
                        video.controls = true;
                        video.style.width = '100%';
                        video.style.height = '100%';
                        video.src = url;
                        playerContainer.appendChild(video);
                        player = video;

                        video.onplay = () => { if (!isSyncing) broadcastPlayerJSState(); };
                        video.onpause = () => { if (!isSyncing) broadcastPlayerJSState(); };
                        video.ontimeupdate = () => {
                            updatePlayerJSTimeDisplay();
                            const now = Date.now();
                            if (now - lastSyncTime > 2000 && !video.paused) {
                                broadcastPlayerJSState();
                                lastSyncTime = now;
                            }
                        };
                        updateSyncStatus('Нативний HLS fallback ✅', 'warning');
                        addSystemMessage(`${userName} завантажив HLS потік через HTML5 fallback 📡`);
                    }
                } else {
                    // Звичайне відео через HTML5 (без PlayerJS)
                    const video = document.createElement('video');
                    video.controls = true;
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.src = url;
                    playerContainer.appendChild(video);
                    player = video;

                    video.onplay = () => { if (!isSyncing) broadcastPlayerJSState(); };
                    video.onpause = () => { if (!isSyncing) broadcastPlayerJSState(); };
                    video.ontimeupdate = () => {
                        updatePlayerJSTimeDisplay();
                        const now = Date.now();
                        if (now - lastSyncTime > 2000 && !video.paused) {
                            broadcastPlayerJSState();
                            lastSyncTime = now;
                        }
                    };
                    updateSyncStatus('HTML5 плеєр готовий ✅', 'success');
                    addSystemMessage(`${userName} завантажив відео через HTML5 🎬`);
                }
                
                roomRef.child('video').set({
                    type: 'playerjs',
                    url: url,
                    qualityLevel: "auto",
                    currentTime: 0,
                    isPlaying: false,
                    updatedBy: userId,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                });
                
            } catch (error) {
                console.error('Помилка PlayerJS:', error);
                container.innerHTML = `
                    <div class="playerjs-error">
                        ❌ Помилка завантаження відео<br>
                        <small>${error.message}</small>
                        <button class="btn-secondary" onclick="retryPlayerJS('${url}')" style="margin-top: 10px;">🔄 Спробувати знову</button>
                    </div>
                `;
            }
            
            // Запускаємо синхронізацію для PlayerJS
            startPlayerJSSync();
        }

        function setupPlayerJSListeners() {
            if (!playerjsInstance) return;
            
            // PlayerJS події
            playerjsInstance.on('play', () => {
                if (!isSyncing) broadcastPlayerJSState();
                document.getElementById('playerjsTimeDisplay').innerHTML = '▶ Відтворення';
            });
            
            playerjsInstance.on('pause', () => {
                if (!isSyncing) broadcastPlayerJSState();
                document.getElementById('playerjsTimeDisplay').innerHTML = '⏸ Пауза';
            });
            
            playerjsInstance.on('timeupdate', (time) => {
                if (!isSyncing) {
                    const now = Date.now();
                    if (now - lastSyncTime > 2000) {
                        broadcastPlayerJSState();
                        lastSyncTime = now;
                    }
                }
            });
            
            updateSyncStatus('PlayerJS готовий ✅', 'success');
            addSystemMessage(`${userName} завантажив відео через PlayerJS 🎯`);
        }

        function retryPlayerJS(url) {
            loadPlayerJS(url);
        }

        function resetPlayerJSQualitySelector() {
            const select = document.getElementById('playerjsQuality');
            if (!select) return;
            select.innerHTML = '<option value="auto">Якість: Авто</option>';
            select.value = "auto";
            select.disabled = true;
            playerjsDesiredQuality = "auto";
        }

        function populatePlayerJSQualitySelector(hls) {
            const select = document.getElementById('playerjsQuality');
            if (!select) return;

            const levels = hls.levels || [];
            select.innerHTML = '<option value="auto">Якість: Авто</option>';

            levels.forEach((level, idx) => {
                const option = document.createElement('option');
                const height = level.height ? `${level.height}p` : `Level ${idx + 1}`;
                const bitrate = level.bitrate ? ` (${Math.round(level.bitrate / 1000)} kbps)` : '';
                option.value = String(idx);
                option.textContent = `Якість: ${height}${bitrate}`;
                select.appendChild(option);
            });

            select.disabled = levels.length === 0;
            select.value = "auto";
            if (playerjsDesiredQuality !== "auto") {
                const hasDesired = [...select.options].some(opt => opt.value === String(playerjsDesiredQuality));
                if (hasDesired) {
                    suppressQualityBroadcast = true;
                    select.value = String(playerjsDesiredQuality);
                    changePlayerJSQuality(String(playerjsDesiredQuality), true);
                    suppressQualityBroadcast = false;
                }
            }
        }

        function changePlayerJSQuality(value, silent = false) {
            playerjsDesiredQuality = String(value);
            if (!playerjsHlsInstance) {
                if (!silent) {
                    showNotification('ℹ️ Вибір якості доступний лише для HLS потоків', 'warning');
                }
                return;
            }

            if (value === "auto") {
                playerjsHlsInstance.currentLevel = -1;
            } else {
                const level = Number(value);
                if (!Number.isNaN(level)) {
                    playerjsHlsInstance.currentLevel = level;
                }
            }

            if (!suppressQualityBroadcast && roomRef && videoType === 'playerjs') {
                roomRef.child('video').update({
                    qualityLevel: value,
                    updatedBy: userId,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                });
            }
        }

        function startPlayerJSSync() {
            if (playerjsSyncInterval) clearInterval(playerjsSyncInterval);
            
            playerjsSyncInterval = setInterval(() => {
                if (!player || videoType !== 'playerjs') return;
                
                try {
                    let currentTime = 0;
                    let duration = 0;
                    
                    if (playerjsInstance && playerjsInstance.getTime) {
                        currentTime = playerjsInstance.getTime();
                        duration = playerjsInstance.getDuration() || 0;
                    } else if (player && player.currentTime !== undefined) {
                        currentTime = player.currentTime;
                        duration = player.duration || 0;
                    }
                    
                    updatePlayerJSTimeDisplay(currentTime, duration);
                    
                    // Синхронізація
                    if (!isHost && !isSyncing && Math.abs(currentTime - playerjsLastTime) > 3) {
                        syncToPlayerJSTime(playerjsLastTime);
                    }
                    
                } catch (e) {
                    console.log('Помилка синхронізації PlayerJS:', e);
                }
            }, 2000);
        }

        function updatePlayerJSTimeDisplay(currentTime, duration) {
            const display = document.getElementById('playerjsTimeDisplay');
            const progress = document.getElementById('playerjsProgress');
            
            if (currentTime !== undefined && duration) {
                display.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
                progress.value = (currentTime / duration) * 1000;
            }
        }

        function playerjsAction(action) {
            if (!player && !playerjsInstance) return;
            
            try {
                if (playerjsInstance) {
                    if (action === 'play') playerjsInstance.play();
                    else if (action === 'pause') playerjsInstance.pause();
                } else if (player) {
                    if (action === 'play') player.play();
                    else if (action === 'pause') player.pause();
                }
                
                setTimeout(broadcastPlayerJSState, 100);
            } catch (e) {
                console.error('Помилка керування PlayerJS:', e);
            }
        }

        function playerjsSeek(seconds) {
            if (!player && !playerjsInstance) return;
            
            try {
                let currentTime = 0;
                if (playerjsInstance && playerjsInstance.getTime) {
                    currentTime = playerjsInstance.getTime();
                    playerjsInstance.setTime(currentTime + seconds);
                } else if (player) {
                    player.currentTime += seconds;
                }
                
                setTimeout(broadcastPlayerJSState, 100);
            } catch (e) {
                console.error('Помилка перемотки PlayerJS:', e);
            }
        }

        function playerjsManualSeek(value) {
            if (!player && !playerjsInstance) return;
            
            try {
                let duration = 0;
                if (playerjsInstance && playerjsInstance.getDuration) {
                    duration = playerjsInstance.getDuration();
                    const time = (value / 1000) * duration;
                    playerjsInstance.setTime(time);
                } else if (player) {
                    duration = player.duration;
                    const time = (value / 1000) * duration;
                    player.currentTime = time;
                }
            } catch (e) {
                console.error('Помилка ручної перемотки PlayerJS:', e);
            }
        }

        function broadcastPlayerJSState() {
            if (!roomRef || videoType !== 'playerjs') return;
            
            try {
                let currentTime = 0;
                let isPlaying = false;
                
                if (playerjsInstance && playerjsInstance.getTime) {
                    currentTime = playerjsInstance.getTime();
                    // PlayerJS не має прямого методу для перевірки стану, використовуємо приблизний
                    isPlaying = true; // Припускаємо що грає
                } else if (player) {
                    currentTime = player.currentTime;
                    isPlaying = !player.paused;
                }
                
                roomRef.child('video').update({
                    type: 'playerjs',
                    currentTime: currentTime,
                    isPlaying: isPlaying,
                    updatedBy: userId,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                });
                
                playerjsLastTime = currentTime;
            } catch (e) {
                console.error('Помилка трансляції стану PlayerJS:', e);
            }
        }

        function syncToPlayerJSTime(targetTime) {
            if (!player && !playerjsInstance || Math.abs(playerjsLastTime - targetTime) < 2) return;
            
            isSeeking = true;
            isSyncing = true;
            
            try {
                if (playerjsInstance && playerjsInstance.setTime) {
                    playerjsInstance.setTime(targetTime);
                } else if (player) {
                    player.currentTime = targetTime;
                }
            } catch (e) {
                console.error('Помилка синхронізації PlayerJS:', e);
            }
            
            setTimeout(() => { 
                isSeeking = false;
                isSyncing = false;
            }, 1000);
        }

        // ========== СУПЕР-СИНХРОНІЗАЦІЯ ДЛЯ IFRAME ==========
        function loadIframeWithSync(url) {
            const container = document.getElementById('videoPlayer');
            
            container.innerHTML = `
                <div style="position: relative; width: 100%; height: 100%;">
                    <iframe 
                        id="syncIframe" 
                        src="${url}" 
                        style="width: 100%; height: 100%; border: none;"
                        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation"
                        allowfullscreen
                    ></iframe>
                </div>
            `;
            
            currentIframe = document.getElementById('syncIframe');
            
            updateSyncStatus('🌟 Супер-синхронізація активна', 'syncing');
            
            roomRef.child('video').set({
                type: 'iframe-sync',
                url: url,
                timestamp: 0,
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            // Запускаємо детектор часу
            startIframeTimeDetector();
            
            addSystemMessage(`${userName} активував СУПЕР-синхронізацію iframe 🌟`);
        }

        function startIframeTimeDetector() {
            if (iframeChecker) clearInterval(iframeChecker);
            
            iframeChecker = setInterval(() => {
                if (!currentIframe || videoType !== 'iframe-sync') return;
                
                try {
                    const iframeDoc = currentIframe.contentDocument || currentIframe.contentWindow.document;
                    
                    if (iframeDoc) {
                        // Шукаємо всі можливі відео-елементи
                        const videos = iframeDoc.querySelectorAll('video, .video-js video, .jw-video, [data-video]');
                        
                        if (videos.length > 0) {
                            const video = videos[0];
                            if (video.currentTime !== undefined && !isNaN(video.currentTime)) {
                                const currentTime = video.currentTime;
                                const duration = video.duration || 0;
                                
                                if (Math.abs(currentTime - lastIframeTime) > 1) {
                                    lastIframeTime = currentTime;
                                    updateIframeTimeDisplay(currentTime, duration);
                                    
                                    // Розсилаємо час (тільки хост)
                                    if (isHost) {
                                        broadcastIframeTime(currentTime);
                                    }
                                    
                                    // Синхронізуємося якщо ми не хост і час відрізняється
                                    if (!isHost && !isSeeking) {
                                        syncToIframeTime(currentTime);
                                    }
                                }
                            }
                        } else {
                            // Якщо не знайшли відео, пробуємо знайти по data-атрибутах
                            const timeElements = iframeDoc.querySelectorAll('[data-currenttime], [data-time], [data-current-time]');
                            if (timeElements.length > 0) {
                                const timeStr = timeElements[0].getAttribute('data-currenttime') || 
                                               timeElements[0].getAttribute('data-time') ||
                                               timeElements[0].getAttribute('data-current-time');
                                if (timeStr) {
                                    const currentTime = parseFloat(timeStr);
                                    if (!isNaN(currentTime)) {
                                        lastIframeTime = currentTime;
                                        if (isHost) broadcastIframeTime(currentTime);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Через CORS не можемо отримати доступ - використовуємо ручні маркери
                    if (isHost && Math.random() < 0.1) { // 10% шанс
                        suggestManualSync();
                    }
                }
            }, 2000);
        }

        function broadcastIframeTime(time) {
            if (!roomRef || !isHost) return;
            
            roomRef.child('video').update({
                timestamp: time,
                hostTime: Date.now(),
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
        }

        function syncToIframeTime(targetTime) {
            if (!currentIframe || Math.abs(lastIframeTime - targetTime) < 3) return;
            
            isSeeking = true;
            
            try {
                const iframeDoc = currentIframe.contentDocument || currentIframe.contentWindow.document;
                if (iframeDoc) {
                    const videos = iframeDoc.querySelectorAll('video');
                    videos.forEach(video => {
                        if (Math.abs(video.currentTime - targetTime) > 3) {
                            video.currentTime = targetTime;
                        }
                    });
                }
            } catch (e) {
                // Якщо не можемо змінити час, показуємо підказку
                if (targetTime > 0) {
                    showSeekSuggestion(targetTime);
                }
            }
            
            setTimeout(() => { isSeeking = false; }, 1000);
        }

        function showSeekSuggestion(targetTime) {
            const timeFormatted = formatTime(targetTime);
            
            // Перевіряємо чи вже є таке повідомлення
            if (document.getElementById('seek-suggestion-' + targetTime)) return;
            
            const suggestion = document.createElement('div');
            suggestion.id = 'seek-suggestion-' + targetTime;
            suggestion.className = 'seek-suggestion';
            suggestion.innerHTML = `
                <strong>🎯 Синхронізація</strong><br>
                Хост на ${timeFormatted}<br>
                <button onclick="manualSeekToTime(${targetTime}); this.parentElement.remove()">
                    ⏩ Перемотати до ${timeFormatted}
                </button>
                <button onclick="this.parentElement.remove()" style="background: transparent; color: white; margin-top: 5px;">
                    ✋ Залишити
                </button>
            `;
            document.body.appendChild(suggestion);
            
            setTimeout(() => {
                if (suggestion.parentElement) suggestion.remove();
            }, 10000);
        }

        function manualSeekToTime(time) {
            if (!currentIframe) return;
            
            try {
                const iframeDoc = currentIframe.contentDocument || currentIframe.contentWindow.document;
                if (iframeDoc) {
                    const videos = iframeDoc.querySelectorAll('video');
                    videos.forEach(video => {
                        video.currentTime = time;
                    });
                    showNotification(`⏩ Перемотано до ${formatTime(time)}`);
                }
            } catch (e) {
                showNotification('❌ Не вдалося перемотати автоматично', 'error');
            }
        }

        function markTimestamp() {
            if (!isHost) {
                showNotification('❌ Тільки хост може створювати маркери', 'error');
                return;
            }
            
            const markerName = prompt('Введіть назву маркера (наприклад: "Початок 2 серії", "Кульмінація"):');
            if (!markerName) return;
            
            const timestamp = lastIframeTime || 0;
            
            roomRef.child('markers').push({
                name: markerName,
                time: timestamp,
                createdBy: userName,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            addSystemMessage(`📍 ${userName} створив маркер: "${markerName}" (${formatTime(timestamp)})`);
        }

        function generateTimecodes() {
            if (!isHost) {
                showNotification('❌ Тільки хост може додавати таймкоди', 'error');
                return;
            }
            
            const timecodes = [
                { name: "🎬 Початок фільму", time: 0 },
                { name: "⭐ Відкриття", time: 120 },
                { name: "🔥 Зав'язка", time: 600 },
                { name: "🎭 Розвиток подій", time: 1800 },
                { name: "⚡ Кульмінація", time: 3600 },
                { name: "🏁 Розв'язка", time: 5400 },
                { name: "📜 Титры", time: 6000 }
            ];
            
            timecodes.forEach(tc => {
                roomRef.child('markers').push({
                    name: tc.name,
                    time: tc.time,
                    createdBy: 'Система',
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                });
            });
            
            addSystemMessage('⏱️ Додано базові таймкоди! Використовуйте для навігації');
        }

        function updateMarkersBar() {
            const markersBar = document.getElementById('markersBar');
            if (!markersBar) return;
            
            markersBar.innerHTML = '';
            
            if (markersList.length === 0) {
                markersBar.innerHTML = '<div style="color: #888;">📍 Немає маркерів</div>';
                return;
            }
            
            // Сортуємо за часом
            markersList.sort((a, b) => a.time - b.time);
            
            markersList.forEach(marker => {
                const btn = document.createElement('button');
                btn.className = 'marker-btn';
                btn.innerHTML = `${marker.name} (${formatTime(marker.time)})`;
                btn.onclick = () => jumpToMarker(marker.time);
                markersBar.appendChild(btn);
            });
        }

        function jumpToMarker(time) {
            if (videoType === 'playerjs') {
                if (playerjsInstance && playerjsInstance.setTime) {
                    playerjsInstance.setTime(time);
                } else if (player) {
                    player.currentTime = time;
                }
                showNotification(`⏩ Перехід до ${formatTime(time)}`);
            } else if (videoType !== 'iframe-sync' || !currentIframe) return;
            
            try {
                const iframeDoc = currentIframe?.contentDocument || currentIframe?.contentWindow.document;
                if (iframeDoc) {
                    const videos = iframeDoc.querySelectorAll('video');
                    if (videos.length > 0) {
                        videos[0].currentTime = time;
                        showNotification(`⏩ Перехід до ${formatTime(time)}`);
                        
                        // Повідомлення в чат
                        addSystemMessage(`${userName} перейшов до маркера ${formatTime(time)}`);
                    } else {
                        showSeekSuggestion(time);
                    }
                }
            } catch (e) {
                showSeekSuggestion(time);
            }
        }

        function showMarkersList() {
            if (markersList.length === 0) {
                showNotification('📍 Немає маркерів', 'warning');
                return;
            }
            
            let message = '📍 МАРКЕРИ:\n';
            markersList.sort((a, b) => a.time - b.time).forEach(m => {
                message += `${formatTime(m.time)} - ${m.name} (${m.createdBy})\n`;
            });
            
            alert(message);
        }

        function suggestManualSync() {
            if (!isHost) return;
            
            roomRef.child('chat').push({
                userId: 'system',
                userName: 'Система',
                text: `💡 Підказка: створіть маркер в ключовому місці для синхронізації!`,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        }

        function syncAllUsers() {
            if (!isHost) {
                showNotification('❌ Тільки хост може синхронізувати всіх', 'error');
                return;
            }
            
            if (videoType === 'iframe-sync') {
                broadcastIframeTime(lastIframeTime);
                addSystemMessage(`🔄 ${userName} ініціював глобальну синхронізацію`);
                showNotification('🔄 Синхронізацію надіслано всім');
            } else if (videoType === 'playerjs') {
                broadcastPlayerJSState();
                addSystemMessage(`🔄 ${userName} ініціював глобальну синхронізацію PlayerJS`);
                showNotification('🔄 Синхронізацію надіслано всім');
            } else {
                syncRequest();
            }
        }

        function syncVideoState(state) {
            if (state.type === 'playerjs') {
                if (videoType !== 'playerjs') {
                    setVideoType('playerjs');
                    setTimeout(() => {
                        if (state.url) {
                            document.getElementById('videoUrl').value = state.url;
                            loadPlayerJS(state.url);
                        }
                    }, 500);
                }

                if (state.qualityLevel !== undefined && !isHost) {
                    playerjsDesiredQuality = String(state.qualityLevel);
                    const select = document.getElementById('playerjsQuality');
                    if (select && select.value !== String(state.qualityLevel)) {
                        suppressQualityBroadcast = true;
                        select.value = String(state.qualityLevel);
                        changePlayerJSQuality(String(state.qualityLevel), true);
                        suppressQualityBroadcast = false;
                    }
                }
                
                if (state.currentTime !== undefined && !isHost && !isSeeking) {
                    syncToPlayerJSTime(state.currentTime);
                }
                
                // Синхронізація стану відтворення
                if (state.isPlaying !== undefined && player) {
                    if (state.isPlaying && player.paused) {
                        player.play().catch(e => console.log('Autoplay blocked'));
                    } else if (!state.isPlaying && !player.paused) {
                        player.pause();
                    }
                }
            }
            else if (state.type === 'youtube' && state.videoId) {
                const container = document.getElementById('videoPlayer');
                const iframe = container.querySelector('iframe');
                if (!iframe || !iframe.src.includes(state.videoId)) {
                    container.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${state.videoId}?enablejsapi=1" frameborder="0" allowfullscreen></iframe>`;
                }
            } 
            else if (state.type === 'iframe' && state.url) {
                const container = document.getElementById('videoPlayer');
                const iframe = container.querySelector('iframe');
                if (!iframe || iframe.src !== state.url) {
                    container.innerHTML = `<iframe src="${state.url}" width="100%" height="100%" frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-presentation allow-forms"></iframe>`;
                }
            }
            else if (state.type === 'iframe-sync' && state.url) {
                const container = document.getElementById('videoPlayer');
                const iframe = container.querySelector('iframe');
                if (!iframe || iframe.src !== state.url) {
                    container.innerHTML = `
                        <div style="position: relative; width: 100%; height: 100%;">
                            <iframe id="syncIframe" src="${state.url}" style="width: 100%; height: 100%; border: none;" sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation" allowfullscreen></iframe>
                        </div>
                    `;
                    currentIframe = document.getElementById('syncIframe');
                    startIframeTimeDetector();
                }
                
                // Синхронізація часу
                if (state.timestamp && !isHost && !isSeeking) {
                    syncToIframeTime(state.timestamp);
                }
            }
            else if (state.type === 'html5' && player) {
                isSyncing = true;
                if (player.src !== state.url && state.url) player.src = state.url;
                if (Math.abs(player.currentTime - state.currentTime) > 2) player.currentTime = state.currentTime;
                if (state.isPlaying && player.paused) {
                    player.play().catch(e => console.log('Autoplay blocked'));
                } else if (!state.isPlaying && !player.paused) {
                    player.pause();
                }
                setTimeout(() => isSyncing = false, 500);
            }
            else if (state.type === 'none') {
                document.getElementById('videoPlayer').innerHTML = '';
                updateSyncStatus('Очікування відео...', 'success');
            }
        }

        function broadcastState() {
            if (!roomRef) return;
            
            if (videoType === 'playerjs') {
                broadcastPlayerJSState();
                return;
            }
            
            if (videoType !== 'html5') return;
            
            roomRef.child('video').update({
                currentTime: player.currentTime,
                isPlaying: !player.paused,
                updatedBy: userId,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });
        }

        function videoAction(action) {
            if (videoType === 'playerjs') {
                playerjsAction(action);
                return;
            }
            
            if (videoType !== 'html5' || !player) {
                showNotification('⚠️ Керування тільки для MP4 відео', 'error');
                return;
            }
            if (action === 'play') {
                player.play();
                updateSyncStatus('▶ Відтворення', 'success');
            } else if (action === 'pause') {
                player.pause();
                updateSyncStatus('⏸ Пауза', 'success');
            }
            setTimeout(broadcastState, 100);
        }

        function seekRelative(seconds) {
            if (videoType === 'playerjs') {
                playerjsSeek(seconds);
                return;
            }
            
            if (videoType === 'iframe-sync' && currentIframe) {
                // Для iframe пропонуємо перемотку
                const newTime = lastIframeTime + seconds;
                if (newTime >= 0) {
                    showSeekSuggestion(newTime);
                    if (isHost) {
                        addSystemMessage(`${userName} пропонує перемотати ${seconds > 0 ? '+' : ''}${seconds}с`);
                    }
                }
                return;
            }
            
            if (videoType !== 'html5' || !player) {
                showNotification('⚠️ Перемотка тільки для MP4 відео', 'error');
                return;
            }
            player.currentTime += seconds;
            updateTimeDisplay();
            setTimeout(broadcastState, 100);
        }

        function manualSeek(value) {
            if (videoType !== 'html5' || !player) return;
            const time = (value / 1000) * player.duration;
            player.currentTime = time;
            updateTimeDisplay();
        }

        function syncRequest() {
            if (videoType === 'iframe-sync' || videoType === 'playerjs') {
                syncAllUsers();
                return;
            }
            
            if (videoType !== 'html5') {
                showNotification('📺 Для цього режиму натисніть Play одночасно вручну');
                return;
            }
            broadcastState();
            showNotification('🔄 Синхронізація надіслана!');
            addSystemMessage(`${userName} синхронізував відео 🔄`);
        }

        function updateTimeDisplay() {
            if (!player || videoType !== 'html5') return;
            const current = formatTime(player.currentTime || 0);
            const total = formatTime(player.duration || 0);
            document.getElementById('timeDisplay').textContent = `${current} / ${total}`;
            if (player.duration) {
                const progress = (player.currentTime / player.duration) * 1000;
                document.getElementById('progressBar').value = progress;
            }
        }

        function updateIframeTimeDisplay(currentTime, duration) {
            const timeDisplay = document.getElementById('timeDisplay');
            if (timeDisplay) {
                timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
            }
        }

        function formatTime(seconds) {
            if (isNaN(seconds) || seconds === undefined) return '00:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        function updateSyncStatus(text, type) {
            document.getElementById('syncText').textContent = text;
            const indicator = document.getElementById('syncIndicator');
            indicator.className = 'sync-indicator';
            if (type === 'error') indicator.classList.add('offline');
            else if (type === 'syncing') indicator.classList.add('syncing');
        }

        function checkActiveStream() {
            roomRef.child('stream').once('value', (snapshot) => {
                const data = snapshot.val();
                const streamButtons = document.getElementById('streamButtons');
                
                if (data && data.active) {
                    document.getElementById('streamStatus').textContent = '🔴 Стрім активний!';
                    streamButtons.innerHTML = `
                        <button class="btn-primary" onclick="joinStream()">👁️ Дивитися стрім</button>
                    `;
                } else {
                    document.getElementById('streamStatus').textContent = '🔴 Стрім не активний';
                    
                    if (isHost) {
                        streamButtons.innerHTML = `
                            <button class="btn-primary" onclick="startScreenShare()">📡 Почати ділитися екраном</button>
                        `;
                    } else {
                        streamButtons.innerHTML = `<p style="color: #888;">Очікуємо поки хост почне стрім...</p>`;
                    }
                }
            });
        }

        async function startScreenShare() {
            if (!isHost) {
                showNotification('❌ Тільки хост може почати стрім', 'error');
                return;
            }
            
            try {
                localStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always" },
                    audio: true
                });
                
                const container = document.getElementById('videoPlayer');
                container.innerHTML = `<video id="localVideo" autoplay muted style="width:100%; height:100%;"></video>`;
                document.getElementById('localVideo').srcObject = localStream;
                
                document.getElementById('streamOverlay').classList.add('hidden');
                document.getElementById('streamControls').style.display = 'flex';
                
                roomRef.child('stream').set({
                    active: true,
                    hostId: userId,
                    hostName: userName,
                    startedAt: firebase.database.ServerValue.TIMESTAMP
                });
                
                isStreaming = true;
                updateSyncStatus('🔴 Ви стрімите!', 'streaming');
                addSystemMessage(`${userName} почав стрім екрану! 🔴📡`);
                
                localStream.getVideoTracks()[0].onended = () => {
                    stopScreenShare();
                };
                
            } catch (err) {
                console.error('Помилка стріму:', err);
                showNotification('❌ Не вдалося почати стрім: ' + err.message, 'error');
            }
        }

        function joinStream() {
            showNotification('📡 Приєднання до стріму...');
            
            document.getElementById('streamOverlay').classList.add('hidden');
            document.getElementById('videoPlayer').innerHTML = `
                <div style="width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#000; color:#fff;">
                    <div style="font-size:4rem; margin-bottom:20px;">🔴 LIVE</div>
                    <div style="font-size:1.2rem; color:#888;">
                        Стрім від хоста активний!<br>
                        <small>Для перегляду потрібен окремий додаток</small>
                    </div>
                </div>
            `;
            
            updateSyncStatus('🔴 Дивитеся стрім', 'streaming');
        }

        function stopScreenShare() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            
            document.getElementById('videoPlayer').innerHTML = '';
            document.getElementById('streamOverlay').classList.remove('hidden');
            document.getElementById('streamControls').style.display = 'none';
            
            roomRef.child('stream').set({
                active: false,
                hostId: null,
                stoppedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            isStreaming = false;
            checkActiveStream();
            updateSyncStatus('Стрім зупинено', 'success');
            addSystemMessage(`${userName} зупинив стрім ⏹`);
        }

        function handleStreamUpdate(data) {
            if (!data || !data.active) {
                if (videoType === 'stream' && !isHost && !isStreaming) {
                    document.getElementById('streamOverlay').classList.remove('hidden');
                    document.getElementById('videoPlayer').innerHTML = '';
                    checkActiveStream();
                }
                return;
            }
            
            if (videoType === 'stream' && !isHost && data.hostId !== userId) {
                document.getElementById('streamStatus').textContent = `🔴 Стрім від ${data.hostName || 'хоста'}!`;
                document.getElementById('streamButtons').innerHTML = `
                    <button class="btn-primary" onclick="joinStream()">👁️ Дивитися стрім</button>
                `;
            }
        }

        function addEmoji(emoji) {
            const input = document.getElementById('chatInput');
            input.value += emoji;
            input.focus();
        }

        function mentionUser(name) {
            const input = document.getElementById('chatInput');
            input.value += '@' + name.split(' ')[0] + ' ';
            input.focus();
        }

        function handleInput(e) {
            const value = e.target.value;
            const lastAt = value.lastIndexOf('@');
            
            if (lastAt !== -1 && (lastAt === value.length - 1 || !value.slice(lastAt + 1).includes(' '))) {
                const query = value.slice(lastAt + 1).toLowerCase();
                showMentionList(query);
            } else {
                document.getElementById('mentionList').style.display = 'none';
            }
        }

        function showMentionList(query) {
            const list = document.getElementById('mentionList');
            list.innerHTML = '';
            list.style.display = 'block';
            
            Object.values(usersList).forEach(user => {
                if (user.name.toLowerCase().includes(query)) {
                    const div = document.createElement('div');
                    div.style.padding = '10px';
                    div.style.cursor = 'pointer';
                    div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
                    div.textContent = user.name;
                    div.onclick = () => selectMention(user.name);
                    list.appendChild(div);
                }
            });
            
            if (list.children.length === 0) list.style.display = 'none';
        }

        function selectMention(name) {
            const input = document.getElementById('chatInput');
            const lastAt = input.value.lastIndexOf('@');
            input.value = input.value.slice(0, lastAt) + '@' + name.split(' ')[0] + ' ';
            document.getElementById('mentionList').style.display = 'none';
            input.focus();
        }

        function handleChatKey(e) {
            if (e.key === 'Enter') sendMessage();
        }

        function setReply(msgId, userName) {
            replyTo = { id: msgId, name: userName };
            document.getElementById('replyPreview').style.display = 'flex';
            document.getElementById('replyToName').textContent = userName;
            document.getElementById('chatInput').focus();
        }

        function cancelReply() {
            replyTo = null;
            document.getElementById('replyPreview').style.display = 'none';
        }

        function sendMessage() {
            const input = document.getElementById('chatInput');
            let text = input.value.trim();
            if (!text || !roomRef) return;
            
            const mentions = [];
            Object.values(usersList).forEach(user => {
                const firstName = user.name.split(' ')[0];
                if (text.includes('@' + firstName)) {
                    mentions.push(user.name);
                    text = text.replace('@' + firstName, `<span class="mention">@${firstName}</span>`);
                }
            });
            
            const msg = {
                userId: userId,
                userName: userName,
                text: text,
                replyTo: replyTo,
                mentions: mentions,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            };
            
            roomRef.child('chat').push(msg);
            displayMessage(msg);
            input.value = '';
            cancelReply();
        }

        function displayMessage(msg) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.className = 'message';
            if (msg.replyTo) div.classList.add('reply');
            
            let authorColor = '#4ecdc4';
            if (msg.userId === userId) authorColor = '#ff6b6b';
            
            let html = '';
            if (msg.replyTo) {
                html += `<div class="reply-to">↳ Відповідь ${msg.replyTo.name}</div>`;
            }
            
            html += `<div class="author" style="color: ${authorColor}" onclick="setReply('${msg.userId}', '${msg.userName}')">${msg.userName}</div>`;
            html += `<div>${msg.text}</div>`;
            
            div.innerHTML = html;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
            
            if (msg.mentions && msg.mentions.includes(userName) && msg.userId !== userId) {
                showNotification(`📢 ${msg.userName} згадав вас!`);
            }
        }

        function addSystemMessage(text) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.className = 'message system';
            div.innerHTML = `<div class="author">Система 🤖</div><div>${text}</div>`;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        function copyCode() {
            navigator.clipboard.writeText(currentRoom);
            showNotification('📋 Код скопійовано: ' + currentRoom);
        }

        function toggleQR() {
            const qr = document.getElementById('qrContainer');
            qr.style.display = qr.style.display === 'none' ? 'block' : 'none';
        }

        function showNotification(text, type = 'success') {
            const notif = document.getElementById('notification');
            notif.textContent = text;
            notif.style.background = type === 'error' ? 'rgba(244, 67, 54, 0.9)' : 'rgba(78, 205, 196, 0.9)';
            notif.classList.add('show');
            setTimeout(() => notif.classList.remove('show'), 3000);
        }

        window.onload = function() {
            const params = new URLSearchParams(window.location.search);
            const room = params.get('room');
            if (room) {
                document.getElementById('joinCode').value = room;
                showJoin();
            }
        };

        window.onbeforeunload = function() {
            if (roomRef && userId) {
                roomRef.child('users/' + userId).remove();
                if (isStreaming) {
                    roomRef.child('stream').set({ active: false });
                }
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            if (syncInterval) clearInterval(syncInterval);
            if (iframeChecker) clearInterval(iframeChecker);
            if (playerjsSyncInterval) clearInterval(playerjsSyncInterval);
        };
