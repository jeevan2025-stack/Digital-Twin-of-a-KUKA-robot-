/**
 * Robot MQTT Connectivity Module
 * Enables network communication for receiving commands and broadcasting poses
 */

const RobotMQTT = (function() {
    let client = null;
    let publishInterval = null;
    let isConnected = false;
    
    const config = {
        broker: '',
        clientId: 'robot_dt_' + Math.random().toString(16).substr(2, 8),
        username: '',
        password: '',
        commandTopic: 'robot/command',
        poseTopic: 'robot/pose',
        publishRate: 10,
        autoPublish: true
    };

    /**
     * Initialize the MQTT connectivity module
     */
    function init() {
        console.log('=== Robot MQTT Module Initializing ===');
        console.log('MQTT library available:', typeof mqtt !== 'undefined');
        if (typeof mqtt !== 'undefined') {
            console.log('mqtt.connect function exists:', typeof mqtt.connect === 'function');
        }
        
        setupUI();
        setupDraggable();
        setupResizable();
        loadConfig();
        updateClientIdDisplay();
        console.log('Robot MQTT Module initialized with clientId:', config.clientId);
    }

    /**
     * Make the connectivity panel draggable
     */
    function setupDraggable() {
        const panel = document.getElementById('connectivity-panel');
        const header = document.querySelector('.hmi-titlebar');
        
        if (!panel || !header) return;

        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            // Don't drag if clicking control buttons
            if (e.target.closest('.hmi-buttons')) {
                return;
            }
            
            // Don't drag if panel is maximized
            if (panel.classList.contains('maximized')) {
                return;
            }
            
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;

            if (e.target === header || header.contains(e.target)) {
                isDragging = true;
            }
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, panel);
            }
        }

        function dragEnd(e) {
            if (isDragging) {
                initialX = currentX;
                initialY = currentY;
                isDragging = false;
            }
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = 'translate(' + xPos + 'px, ' + yPos + 'px)';
        }
    }

    /**
     * Make the connectivity panel resizable
     */
    function setupResizable() {
        const panel = document.getElementById('connectivity-panel');
        const resizeHandle = document.querySelector('.resize-handle');
        
        if (!panel || !resizeHandle) return;

        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', initResize);

        function initResize(e) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseInt(window.getComputedStyle(panel).width, 10);
            startHeight = parseInt(window.getComputedStyle(panel).height, 10);
            
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
            e.preventDefault();
        }

        function resize(e) {
            if (!isResizing) return;
            
            const width = startWidth + (e.clientX - startX);
            const height = startHeight + (e.clientY - startY);
            
            // Min and max constraints
            if (width >= 400 && width <= 1200) {
                panel.style.width = width + 'px';
            }
            if (height >= 300 && height <= window.innerHeight - 100) {
                panel.style.height = height + 'px';
                panel.style.maxHeight = height + 'px';
            }
        }

        function stopResize() {
            isResizing = false;
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stopResize);
        }
    }

    /**
     * Setup UI event listeners
     */
    function setupUI() {
        // Toggle connectivity panel
        const toggleBtn = document.getElementById('toggleConnectivity');
        const panel = document.getElementById('connectivity-panel');
        const closeBtn = document.getElementById('closeConnectivity');
        const minimizeBtn = document.getElementById('minimizeConnectivity');
        const maximizeBtn = document.getElementById('maximizeConnectivity');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (panel.style.display === 'none' || panel.style.display === '') {
                    panel.style.display = 'block';
                    panel.classList.remove('minimized', 'maximized');
                } else {
                    panel.style.display = 'none';
                }
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.style.display = 'none';
            });
        }

        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                panel.classList.toggle('minimized');
            });
        }

        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', () => {
                panel.classList.toggle('maximized');
            });
        }

        // Connect/Disconnect buttons
        document.getElementById('connectMqtt').addEventListener('click', connect);
        document.getElementById('disconnectMqtt').addEventListener('click', disconnect);

        // Log controls
        document.getElementById('clearLog').addEventListener('click', clearLog);
        document.getElementById('testPublish').addEventListener('click', testPublish);

        // Auto-publish checkbox
        document.getElementById('autoPublish').addEventListener('change', (e) => {
            config.autoPublish = e.target.checked;
            if (isConnected && config.autoPublish) {
                startAutoPublish();
            } else {
                stopAutoPublish();
            }
        });

        // Publish rate change
        document.getElementById('publishRate').addEventListener('change', (e) => {
            config.publishRate = parseInt(e.target.value);
            if (isConnected && config.autoPublish) {
                stopAutoPublish();
                startAutoPublish();
            }
        });
    }

    /**
     * Update client ID display
     */
    function updateClientIdDisplay() {
        document.getElementById('mqttClientId').value = config.clientId;
    }

    /**
     * Load configuration from localStorage
     */
    function loadConfig() {
        const saved = localStorage.getItem('robotMQTTConfig');
        if (saved) {
            try {
                const savedConfig = JSON.parse(saved);
                Object.assign(config, savedConfig);
                
                // Update UI
                document.getElementById('mqttBroker').value = config.broker;
                document.getElementById('mqttUsername').value = config.username;
                document.getElementById('commandTopic').value = config.commandTopic;
                document.getElementById('poseTopic').value = config.poseTopic;
                document.getElementById('publishRate').value = config.publishRate;
                document.getElementById('autoPublish').checked = config.autoPublish;
            } catch (e) {
                console.error('Failed to load MQTT config:', e);
            }
        }
    }

    /**
     * Save configuration to localStorage
     */
    function saveConfig() {
        localStorage.setItem('robotMQTTConfig', JSON.stringify(config));
    }

    /**
     * Connect to MQTT broker
     */
    function connect() {
        // Read configuration from UI
        config.broker = document.getElementById('mqttBroker').value;
        config.username = document.getElementById('mqttUsername').value;
        config.password = document.getElementById('mqttPassword').value;
        config.commandTopic = document.getElementById('commandTopic').value;
        config.poseTopic = document.getElementById('poseTopic').value;

        if (!config.broker) {
            addLog('ERROR: Broker URL is required', 'error');
            return;
        }

        // Check if mqtt library is loaded
        if (typeof mqtt === 'undefined') {
            console.error('MQTT library not loaded!');
            addLog('ERROR: MQTT library not loaded. Check internet connection.', 'error');
            updateStatus('disconnected', 'Library Error');
            return;
        }

        console.log('=== Starting MQTT Connection ===');
        console.log('Broker:', config.broker);
        console.log('Client ID:', config.clientId);
        
        addLog('Connecting to ' + config.broker + '...', 'info');
        updateStatus('connecting', 'Connecting...');

        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
            if (!isConnected) {
                addLog('Connection timeout - broker may be unreachable', 'error');
                updateStatus('disconnected', 'Timeout');
                if (client) {
                    try { client.end(true); } catch(e) {}
                    client = null;
                }
                document.getElementById('connectMqtt').disabled = false;
                document.getElementById('disconnectMqtt').disabled = true;
            }
        }, 10000); // 10 second timeout

        try {
            // MQTT.js connection options
            const options = {
                clientId: config.clientId,
                clean: true,
                reconnectPeriod: 0, // Disable auto-reconnect for now
                connectTimeout: 10000
            };

            if (config.username) {
                options.username = config.username;
                options.password = config.password;
            }

            addLog('Creating connection with clientId: ' + config.clientId, 'info');
            console.log('MQTT options:', options);

            // Connect to broker
            console.log('Calling mqtt.connect...');
            client = mqtt.connect(config.broker, options);
            console.log('MQTT client created:', client);

            // Event handlers
            client.on('connect', () => {
                console.log('MQTT connect event fired!');
                clearTimeout(connectionTimeout);
                onConnect();
            });
            client.on('message', onMessage);
            client.on('error', (error) => {
                console.error('MQTT error event:', error);
                clearTimeout(connectionTimeout);
                onError(error);
            });
            client.on('close', () => {
                console.log('MQTT close event');
                onClose();
            });
            client.on('offline', () => {
                console.log('MQTT offline event');
                addLog('Client went offline', 'error');
            });

        } catch (error) {
            console.error('Exception during connect:', error);
            clearTimeout(connectionTimeout);
            addLog('Connection failed: ' + error.message, 'error');
            updateStatus('disconnected', 'Error');
            document.getElementById('connectMqtt').disabled = false;
            document.getElementById('disconnectMqtt').disabled = true;
        }
    }

    /**
     * Disconnect from MQTT broker
     */
    function disconnect() {
        if (client) {
            stopAutoPublish();
            client.end();
            client = null;
            isConnected = false;
            updateStatus('disconnected', 'Disconnected');
            addLog('Disconnected from broker', 'info');
            
            document.getElementById('connectMqtt').disabled = false;
            document.getElementById('disconnectMqtt').disabled = true;
        }
    }

    /**
     * Handle successful connection
     */
    function onConnect() {
        isConnected = true;
        updateStatus('connected', 'Connected');
        addLog('Connected to broker successfully', 'success');
        
        // Subscribe to command topic
        client.subscribe(config.commandTopic, (err) => {
            if (err) {
                addLog('Failed to subscribe to ' + config.commandTopic, 'error');
            } else {
                addLog('Subscribed to ' + config.commandTopic, 'success');
            }
        });

        // Start auto-publishing if enabled
        if (config.autoPublish) {
            startAutoPublish();
        }

        // Save configuration
        saveConfig();

        // Update UI
        document.getElementById('connectMqtt').disabled = true;
        document.getElementById('disconnectMqtt').disabled = false;
    }

    /**
     * Handle incoming MQTT messages
     */
    function onMessage(topic, message) {
        const payload = message.toString();
        addLog('Received on ' + topic + ': ' + payload, 'received');

        try {
            const command = JSON.parse(payload);
            executeCommand(command);
        } catch (e) {
            addLog('Invalid JSON command: ' + e.message, 'error');
        }
    }

    /**
     * Execute received command
     */
    function executeCommand(command) {
        addLog('Executing command: ' + command.type, 'info');

        switch (command.type) {
            case 'move':
                // Move all joints to specified positions
                if (command.joints) {
                    const animate = command.animate !== false;
                    const duration = command.duration || 1000;
                    SliderControlledX3DElement.loadAllAngles(command.joints, animate, duration);
                    addLog('Moving to position', 'success');
                }
                break;

            case 'move_joint':
                // Move single joint
                if (command.joint && command.angle !== undefined) {
                    SliderControlledX3DElement.forEachInstance(instance => {
                        if (instance.nodeName === command.joint && instance.slider) {
                            instance.slider.value = command.angle;
                            instance.slider.dispatchEvent(new Event('input'));
                        }
                    });
                    addLog('Moved ' + command.joint + ' to ' + command.angle + '°', 'success');
                }
                break;

            case 'home':
                // Return to home position
                const homePositions = { A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0 };
                SliderControlledX3DElement.loadAllAngles(homePositions, true, 1000);
                addLog('Returning to home position', 'success');
                break;

            case 'get_pose':
                // Respond with current pose
                publishPose(true);
                break;

            default:
                addLog('Unknown command type: ' + command.type, 'error');
        }
    }

    /**
     * Handle MQTT errors
     */
    function onError(error) {
        addLog('MQTT Error: ' + error.message, 'error');
        updateStatus('error', 'Error');
    }

    /**
     * Handle connection close
     */
    function onClose() {
        if (isConnected) {
            isConnected = false;
            updateStatus('disconnected', 'Disconnected');
            addLog('Connection closed', 'info');
            stopAutoPublish();
        }
    }

    /**
     * Handle reconnection attempt
     */
    function onReconnect() {
        addLog('Attempting to reconnect...', 'info');
        updateStatus('connecting', 'Reconnecting...');
    }

    /**
     * Start auto-publishing robot pose
     */
    function startAutoPublish() {
        stopAutoPublish(); // Clear any existing interval
        
        const interval = 1000 / config.publishRate; // Convert Hz to ms
        publishInterval = setInterval(() => {
            publishPose();
        }, interval);
        
        addLog('Started auto-publishing at ' + config.publishRate + ' Hz', 'info');
    }

    /**
     * Stop auto-publishing
     */
    function stopAutoPublish() {
        if (publishInterval) {
            clearInterval(publishInterval);
            publishInterval = null;
        }
    }

    /**
     * Publish current robot pose
     */
    function publishPose(force = false) {
        if (!isConnected || (!config.autoPublish && !force)) {
            return;
        }

        const pose = getCurrentPose();
        const message = JSON.stringify(pose);

        client.publish(config.poseTopic, message, (err) => {
            if (err) {
                addLog('Failed to publish pose: ' + err.message, 'error');
            } else if (force) {
                addLog('Published pose: ' + message, 'sent');
            }
        });
    }

    /**
     * Get current robot pose
     */
    function getCurrentPose() {
        const pose = {
            timestamp: Date.now(),
            joints: {},
            client_id: config.clientId
        };

        SliderControlledX3DElement.forEachInstance(instance => {
            if (instance.slider) {
                pose.joints[instance.nodeName] = parseFloat(instance.slider.value);
            }
        });

        return pose;
    }

    /**
     * Test publish functionality
     */
    function testPublish() {
        if (!isConnected) {
            addLog('Not connected to broker', 'error');
            return;
        }

        const testMessage = {
            type: 'test',
            message: 'Test message from Robot Digital Twin',
            timestamp: Date.now()
        };

        client.publish(config.poseTopic, JSON.stringify(testMessage), (err) => {
            if (err) {
                addLog('Test publish failed: ' + err.message, 'error');
            } else {
                addLog('Test message published successfully', 'success');
            }
        });
    }

    /**
     * Update connection status display
     */
    function updateStatus(status, text) {
        const statusEl = document.getElementById('connectionStatus');
        const mqttStatusDot = document.getElementById('mqttStatus');
        
        if (statusEl) {
            statusEl.className = 'connection-status ' + status;
            const statusText = statusEl.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = text;
            }
        }

        if (mqttStatusDot) {
            mqttStatusDot.className = 'mqtt-status ' + (status === 'connected' ? 'online' : 'offline');
        }
    }

    /**
     * Add message to log
     */
    function addLog(message, type = 'info') {
        const logContainer = document.getElementById('messageLog');
        if (!logContainer) return;

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry ' + type;
        logEntry.innerHTML = `<span class="log-time">${timestamp}</span> <span class="log-message">${message}</span>`;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;

        // Limit log entries to 100
        while (logContainer.children.length > 100) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    /**
     * Clear message log
     */
    function clearLog() {
        const logContainer = document.getElementById('messageLog');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    // Public API
    return {
        init: init,
        connect: connect,
        disconnect: disconnect,
        publishPose: publishPose,
        isConnected: () => isConnected,
        getConfig: () => config
    };
})();
