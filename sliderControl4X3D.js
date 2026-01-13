// ============================================================================
// KUKA KR4 R600 Robot Control - Bidirectional Slider/3D Interaction
// ============================================================================
// This controller manages both slider-based and direct 3D interaction control
// for the KUKA KR4 R600 robot model, with full bidirectional synchronization.
//
// Features:
// - Slider control with real-time 3D updates
// - Direct 3D drag interaction with automatic slider sync
// - HOME position offsets (A2=-90°, A3=+90°)
// - Multi-instance management with static methods
// - Save/load configurations (localStorage, JSON)
// - Smooth animations with configurable duration
//
// Author: Sanath
// Created: December 2025 - January 2026
// ============================================================================

// Get X3DBrowser instance from x3d-canvas with class "browser".
// Use X_ITE that's already loaded globally via script tag

(function() {
    'use strict';

class SliderControlledX3DElement {
    // Static array to store all instances
    static instances = [];
    
    /**
     * Note: LoadSensor requires the X3D Full profile.
     */
    constructor({
        browserSelector = ".X3D",
        nodeName,
        sliderContainerId,
        sliderId,
        angleValueId,
        statusId,
        parentContainerId = "controls",  // New parameter: where to insert sliders
        minAngle = -180,                  // New parameter: slider min
        maxAngle = 180,                   // New parameter: slider max
        initialValue = 0,                 // New parameter: initial angle
        label = null                      // New parameter: custom label
    }) {
        if (!nodeName) throw new Error("nodeName is required");
        this.browserSelector = browserSelector;
        this.scene = null;
        this.nodeName = nodeName;
        this.axis = null;
        this.initEAICount = 0;
        this.tooltipRetryCount = 0;  // Track tooltip setup retries
        
        // HOME position offsets (geometry is modeled at HOME)
        // When slider shows these values, actual rotation should be 0
        const homeOffsets = {
            'A1': 0,
            'A2': 0,
            'A3': 0,
            'A4': 0,
            'A5': 0,
            'A6': 0
        };
        this.homeOffset = homeOffsets[nodeName] || 0;
        
        // Store configuration
        this.config = {
            parentContainerId,
            sliderContainerId: sliderContainerId || `sliderContainer_${nodeName}`,
            sliderId: sliderId || `angleSlider_${nodeName}`,
            angleValueId: angleValueId || `angleValue_${nodeName}`,
            statusId: statusId || `status_${nodeName}`,
            minAngle,
            maxAngle,
            initialValue,
            label: label || nodeName
        };
        
        // define a global counter for all instances
        if (typeof SliderControlledX3DElement.globalInitCount === 'undefined') {
            SliderControlledX3DElement.globalInitCount = 0;
        }
        SliderControlledX3DElement.globalInitCount++;
        
        // Add this instance to the static instances array
        SliderControlledX3DElement.instances.push(this);
        
        // Create HTML elements dynamically
        this.createSliderElements();
        
        // Now get references to the created elements
        this.sliderContainer = document.getElementById(this.config.sliderContainerId);
        this.slider = document.getElementById(this.config.sliderId);
        this.angleValue = document.getElementById(this.config.angleValueId);
        this.status = document.getElementById(this.config.statusId);
        
        this.init();
        this.setupSlider();
        this.Rot = null; // will be initialized in initEAI
    }

    /**
     * Create HTML elements for the slider dynamically
     */
    createSliderElements() {
        const parentContainer = document.getElementById(this.config.parentContainerId);
        
        if (!parentContainer) {
            console.error(`Parent container '${this.config.parentContainerId}' not found`);
            return;
        }

        // Create container div with class for styling
        const containerDiv = document.createElement('div');
        containerDiv.id = this.config.sliderContainerId;
        containerDiv.className = 'slider-container';

        // Create label
        const label = document.createElement('label');
        label.textContent = this.config.label + ':';
        label.style.display = 'inline-block';
        label.style.width = '40px';

        // Create slider input
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = this.config.sliderId;
        slider.title = 'angleSlider';
        slider.min = this.config.minAngle;
        slider.max = this.config.maxAngle;
        slider.step = '1';
        slider.value = this.config.initialValue;

        // Create angle value span
        const angleSpan = document.createElement('span');
        angleSpan.id = this.config.angleValueId;
        angleSpan.textContent = this.config.initialValue + '°';
        angleSpan.style.marginLeft = '10px';

        // Create tooltip with joint documentation
        const tooltip = this.createTooltip();

        // Append all elements
        containerDiv.appendChild(label);
        containerDiv.appendChild(slider);
        containerDiv.appendChild(angleSpan);
        containerDiv.appendChild(tooltip);
        parentContainer.appendChild(containerDiv);

        console.log(`Created slider elements for ${this.nodeName}`);
    }

    /**
     * Setup 3D link hover detection to show tooltip overlay
     * Uses the exposed isOver_changed event from RobotJoint PROTO
     */
    setup3DLinkHoverTooltip() {
        const tooltipOverlay = document.getElementById('link-tooltip-overlay');
        const canvas = document.querySelector('.X3D');
        
        if (!tooltipOverlay || !canvas) {
            console.warn('Tooltip overlay or canvas not found');
            return;
        }

        // Comprehensive specifications for all robot components
        const componentSpecs = {
            'A1': {
                description: 'Base Swivel',
                axis: 'Z-axis (0, 0, 1)',
                range: '±165°',
                minAngle: '-165°',
                maxAngle: '+165°',
                maxSpeed: '312°/s',
                home: '0°',
                function: 'Rotates entire arm horizontally',
                type: 'Rotary Joint',
                payload: 'Full robot payload'
            },
            'A2': {
                description: 'Shoulder Joint',
                axis: 'Y-axis (0, 1, 0)',
                range: '-190° to +35°',
                minAngle: '-190°',
                maxAngle: '+35°',
                maxSpeed: '312°/s',
                home: '-90°',
                function: 'Controls arm elevation',
                type: 'Rotary Joint',
                payload: 'Arm + end effector'
            },
            'A3': {
                description: 'Elbow Joint',
                axis: 'Y-axis (0, 1, 0)',
                range: '-110° to +145°',
                minAngle: '-110°',
                maxAngle: '+145°',
                maxSpeed: '312°/s',
                home: '+90°',
                function: 'Extends/retracts forearm',
                type: 'Rotary Joint',
                payload: 'Forearm + wrist'
            },
            'A4': {
                description: 'Wrist Rotation',
                axis: 'X-axis (1, 0, 0)',
                range: '±180°',
                minAngle: '-180°',
                maxAngle: '+180°',
                maxSpeed: '540°/s',
                home: '0°',
                function: 'Rotates wrist assembly',
                type: 'Rotary Joint',
                payload: 'Wrist + tool'
            },
            'A5': {
                description: 'Wrist Bend',
                axis: 'Y-axis (0, 1, 0)',
                range: '±115°',
                minAngle: '-115°',
                maxAngle: '+115°',
                maxSpeed: '540°/s',
                home: '0°',
                function: 'Bends end effector up/down',
                type: 'Rotary Joint',
                payload: 'End effector'
            },
            'A6': {
                description: 'Flange Rotation',
                axis: 'X-axis (1, 0, 0)',
                range: '±345°',
                minAngle: '-345°',
                maxAngle: '+345°',
                maxSpeed: '810°/s',
                home: '0°',
                function: 'Rotates tool flange',
                type: 'Rotary Joint',
                payload: 'Tool/gripper'
            },
            'FINGER': {
                description: 'Gripper Finger',
                type: 'End Effector Component',
                function: 'Gripping surface for workpiece',
                material: 'Hardened steel',
                customizable: 'Yes'
            }
        };

        const spec = componentSpecs[this.nodeName];
        if (!spec) {
            console.warn(`No spec found for ${this.nodeName}`);
            return;
        }

        // Access TouchSensor from PROTO's exposed isOver_changed field
        try {
            if (!this.axis) {
                console.warn(`No axis found for ${this.nodeName}`);
                return;
            }

            // Debug: Show what properties are available
            const props = Object.keys(this.axis);
            console.log(`[${this.nodeName}] Available properties (${props.length}):`, props);
            
            // Try to access exposed fields - X_ITE exposes PROTO fields as properties
            // The PROTO declares: eventOut SFBool isOver_changed
            let touchSensorField = null;
            
            // Check if isOver_changed is directly accessible
            if (this.axis.isOver_changed) {
                console.log(`[${this.nodeName}] Found isOver_changed as property`);
                touchSensorField = this.axis.isOver_changed;
            }
            
            // If not, try accessing it through field descriptors
            if (!touchSensorField) {
                // List all fields to see what's available
                console.log(`[${this.nodeName}] Checking for field methods...`);
                if (typeof this.axis.getFieldDefinitions === 'function') {
                    const fieldDefs = this.axis.getFieldDefinitions();
                    console.log(`[${this.nodeName}] Field definitions:`, fieldDefs);
                }
                
                // Try different field access methods
                const fieldAccessMethods = ['getField', 'getUserDefinedField', 'getEventOut'];
                for (const method of fieldAccessMethods) {
                    if (typeof this.axis[method] === 'function') {
                        try {
                            touchSensorField = this.axis[method]('isOver_changed');
                            if (touchSensorField) {
                                console.log(`[${this.nodeName}] Found isOver_changed via ${method}()`);
                                break;
                            }
                        } catch (e) {
                            console.log(`[${this.nodeName}] ${method}() failed:`, e.message);
                        }
                    }
                }
            }
            
            if (touchSensorField && typeof touchSensorField.addFieldCallback === 'function') {
                console.log(`✓ Setting up hover callback for ${this.nodeName}`);
                
                // Register callback for the isOver event
                touchSensorField.addFieldCallback(`hover_${this.nodeName}`, (isOver) => {
                    if (isOver) {
                        // Mouse entered - show tooltip
                        const currentAngle = this.slider ? this.slider.value + '°' : 'N/A';
                        
                        // Build tooltip HTML based on component type
                        let tooltipContent = `<div class="link-title">${this.nodeName} - ${spec.description}</div><div class="link-info">`;
                        
                        if (spec.type === 'Rotary Joint') {
                            tooltipContent += `
                                <div><strong>Type:</strong> ${spec.type}</div>
                                <div><strong>Function:</strong> ${spec.function}</div>
                                <div><strong>Current Angle:</strong> ${currentAngle}</div>
                                <div><strong>Range:</strong> ${spec.range}</div>
                                <div><strong>Min Angle:</strong> ${spec.minAngle}</div>
                                <div><strong>Max Angle:</strong> ${spec.maxAngle}</div>
                                <div><strong>Home Position:</strong> ${spec.home}</div>
                                <div><strong>Rotation Axis:</strong> ${spec.axis}</div>
                                <div><strong>Max Speed:</strong> ${spec.maxSpeed}</div>
                                <div><strong>Payload:</strong> ${spec.payload}</div>
                            `;
                        } else {
                            // Generic component info
                            tooltipContent += `<div><strong>Type:</strong> ${spec.type}</div>`;
                            tooltipContent += `<div><strong>Function:</strong> ${spec.function}</div>`;
                            if (spec.material) tooltipContent += `<div><strong>Material:</strong> ${spec.material}</div>`;
                            if (spec.customizable) tooltipContent += `<div><strong>Customizable:</strong> ${spec.customizable}</div>`;
                        }
                        
                        tooltipContent += `</div>`;
                        tooltipOverlay.innerHTML = tooltipContent;
                        tooltipOverlay.classList.add('visible');
                        tooltipOverlay.dataset.activeComponent = this.nodeName;
                    } else if (tooltipOverlay.dataset.activeComponent === this.nodeName) {
                        // Mouse left - hide tooltip
                        tooltipOverlay.classList.remove('visible');
                        tooltipOverlay.dataset.activeComponent = '';
                    }
                });
                
                console.log(`✓ Hover tooltip enabled for ${this.nodeName}`);
                
                // If this is A6, also setup tooltips for child components (Gripper, AdapterFlange)
                if (this.nodeName === 'A6') {
                    setTimeout(() => {
                        this.setupChildComponentTooltips();
                    }, 500);
                }
            } else {
                console.warn(`isOver_changed field not found for ${this.nodeName} (attempt ${this.tooltipRetryCount + 1}/3)`);
                
                // Retry up to 3 times with increasing delays
                if (this.tooltipRetryCount < 3) {
                    this.tooltipRetryCount++;
                    const delay = this.tooltipRetryCount * 500;
                    setTimeout(() => {
                        this.setup3DLinkHoverTooltip();
                    }, delay);
                } else {
                    console.error(`Failed to setup tooltip for ${this.nodeName} after 3 attempts - isOver_changed field not accessible`);
                }
            }
        } catch (e) {
            console.error(`Error setting up hover tooltip for ${this.nodeName}:`, e);
        }

        // Setup global mouse tracking once for tooltip positioning
        if (!SliderControlledX3DElement.tooltipMouseTracking) {
            SliderControlledX3DElement.tooltipMouseTracking = true;
            
            canvas.addEventListener('mousemove', (event) => {
                if (tooltipOverlay.classList.contains('visible')) {
                    // Position tooltip near cursor with offset
                    tooltipOverlay.style.left = (event.clientX + 20) + 'px';
                    tooltipOverlay.style.top = (event.clientY + 20) + 'px';
                }
            });
            
            canvas.addEventListener('mouseleave', () => {
                // Hide tooltip when leaving canvas
                tooltipOverlay.classList.remove('visible');
                tooltipOverlay.dataset.activeComponent = '';
            });
            
            console.log('✓ Global tooltip mouse tracking enabled');
        }
    }

    /**
     * Setup tooltips for child components (Gripper, AdapterFlange) within A6
     * Also sets up Base tooltip which is at scene root level
     */
    setupChildComponentTooltips() {
        const tooltipOverlay = document.getElementById('link-tooltip-overlay');
        if (!tooltipOverlay || !this.scene) {
            console.warn('Cannot setup child component tooltips - missing overlay or scene');
            return;
        }

        console.log('Setting up tooltips for Gripper, AdapterFlange, and Base...');

        // Component specs
        const componentSpecs = {
            'Gripper': {
                description: 'SCHUNK EGP 40 Gripper',
                type: 'Parallel Gripper',
                stroke: '40mm',
                gripForce: '140N',
                weight: '0.45kg',
                function: 'Pneumatic parallel gripper for parts handling',
                manufacturer: 'SCHUNK'
            },
            'AdapterFlange': {
                description: 'Adapter Flange',
                type: 'Mechanical Interface',
                function: 'Connects robot flange to gripper',
                material: 'Aluminum alloy',
                weight: '0.2kg'
            }
        };

        const componentSensors = {
            'Gripper': 'Gripper_TouchSensor',
            'AdapterFlange': 'AdapterFlange_TouchSensor',
            'Base': 'Base_TouchSensor'
        };

        Object.keys(componentSensors).forEach(componentName => {
            try {
                const touchSensorName = componentSensors[componentName];
                let touchSensor = null;
                
                // For Base, search at scene root level
                // For Gripper and AdapterFlange, search in A6's children
                if (componentName === 'Base') {
                    // Search through entire scene hierarchy for Base
                    const searchNode = (node, targetName, depth = 0) => {
                        const nodeName = node._name || node.name || (node.getNodeName && node.getNodeName());
                        if (nodeName === targetName) {
                            console.log(`  Found ${targetName} at depth ${depth} in scene`);
                            return node;
                        }
                        
                        const childrenArrays = [node._children, node.children];
                        for (const childArray of childrenArrays) {
                            if (childArray && childArray.length > 0) {
                                for (const child of childArray) {
                                    const found = searchNode(child, targetName, depth + 1);
                                    if (found) return found;
                                }
                            }
                        }
                        
                        if (node.getField) {
                            try {
                                const childrenField = node.getField('children');
                                if (childrenField && childrenField.length > 0) {
                                    for (let i = 0; i < childrenField.length; i++) {
                                        const child = childrenField[i];
                                        const found = searchNode(child, targetName, depth + 1);
                                        if (found) return found;
                                    }
                                }
                            } catch (e) {
                                // No children field
                            }
                        }
                        
                        return null;
                    };
                    
                    console.log(`Searching entire scene for ${touchSensorName}...`);
                    // Search from scene root
                    if (this.scene.rootNodes && this.scene.rootNodes.length > 0) {
                        for (const rootNode of this.scene.rootNodes) {
                            touchSensor = searchNode(rootNode, touchSensorName);
                            if (touchSensor) break;
                        }
                    }
                } else {
                    // Search in A6's children for Gripper and AdapterFlange
                    const searchNode = (node, targetName, depth = 0) => {
                        const nodeName = node._name || node.name || (node.getNodeName && node.getNodeName());
                        if (nodeName === targetName) {
                            console.log(`  Found ${targetName} at depth ${depth} from A6`);
                            return node;
                        }
                        
                        const childrenArrays = [node._children, node.children];
                        for (const childArray of childrenArrays) {
                            if (childArray && childArray.length > 0) {
                                for (const child of childArray) {
                                    const found = searchNode(child, targetName, depth + 1);
                                    if (found) return found;
                                }
                            }
                        }
                        
                        if (node.getField) {
                            try {
                                const childrenField = node.getField('children');
                                if (childrenField && childrenField.length > 0) {
                                    for (let i = 0; i < childrenField.length; i++) {
                                        const child = childrenField[i];
                                        const found = searchNode(child, targetName, depth + 1);
                                        if (found) return found;
                                    }
                                }
                            } catch (e) {
                                // No children field
                            }
                        }
                        
                        return null;
                    };
                    
                    console.log(`Searching for ${touchSensorName} in A6's children...`);
                    touchSensor = searchNode(this.axis, touchSensorName);
                }
                
                if (touchSensor && touchSensor.isOver) {
                    console.log(`✓ Found TouchSensor for ${componentName}`);
                    
                    const spec = componentSpecs[componentName];
                    touchSensor.isOver.addFieldCallback(`hover_${componentName}`, (isOver) => {
                        if (isOver && spec) {
                            let tooltipContent = `<div class="link-title">${componentName} - ${spec.description}</div><div class="link-info">`;
                            tooltipContent += `<div><strong>Type:</strong> ${spec.type}</div>`;
                            tooltipContent += `<div><strong>Function:</strong> ${spec.function}</div>`;
                            if (spec.weight) tooltipContent += `<div><strong>Weight:</strong> ${spec.weight}</div>`;
                            if (spec.material) tooltipContent += `<div><strong>Material:</strong> ${spec.material}</div>`;
                            if (spec.manufacturer) tooltipContent += `<div><strong>Manufacturer:</strong> ${spec.manufacturer}</div>`;
                            if (spec.stroke) tooltipContent += `<div><strong>Stroke:</strong> ${spec.stroke}</div>`;
                            if (spec.gripForce) tooltipContent += `<div><strong>Grip Force:</strong> ${spec.gripForce}</div>`;
                            tooltipContent += `</div>`;
                            
                            tooltipOverlay.innerHTML = tooltipContent;
                            tooltipOverlay.classList.add('visible');
                            tooltipOverlay.dataset.activeComponent = componentName;
                        } else if (tooltipOverlay.dataset.activeComponent === componentName) {
                            tooltipOverlay.classList.remove('visible');
                            tooltipOverlay.dataset.activeComponent = '';
                        }
                    });
                    
                    console.log(`✓ Tooltip enabled for ${componentName}`);
                } else {
                    console.warn(`TouchSensor ${touchSensorName} not found in A6's children`);
                }
            } catch (e) {
                console.warn(`Could not setup tooltip for ${componentName}:`, e.message);
            }
        });
    }

    /**
     * Create tooltip element with joint documentation
     */
    createTooltip() {
        // Joint specifications for KUKA KR4 R600
        const jointSpecs = {
            'A1': {
                description: 'Base Swivel',
                axis: 'Z-axis (0, 0, 1)',
                range: '±165°',
                maxSpeed: '312°/s',
                home: '0°'
            },
            'A2': {
                description: 'Shoulder',
                axis: 'Y-axis (0, 1, 0)',
                range: '-190° to +35°',
                maxSpeed: '312°/s',
                home: '-90°'
            },
            'A3': {
                description: 'Elbow',
                axis: 'Y-axis (0, 1, 0)',
                range: '-110° to +145°',
                maxSpeed: '312°/s',
                home: '+90°'
            },
            'A4': {
                description: 'Wrist Rotation',
                axis: 'X-axis (1, 0, 0)',
                range: '±180°',
                maxSpeed: '540°/s',
                home: '0°'
            },
            'A5': {
                description: 'Wrist Bend',
                axis: 'Y-axis (0, 1, 0)',
                range: '±115°',
                maxSpeed: '540°/s',
                home: '0°'
            },
            'A6': {
                description: 'Flange Rotation',
                axis: 'X-axis (1, 0, 0)',
                range: '±345°',
                maxSpeed: '810°/s',
                home: '0°'
            }
        };

        const spec = jointSpecs[this.nodeName] || {
            description: 'Unknown Joint',
            axis: 'N/A',
            range: 'N/A',
            maxSpeed: 'N/A',
            home: 'N/A'
        };

        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-title">${this.nodeName} - ${spec.description}</div>
            <div class="tooltip-info">
                <div><strong>Range:</strong> ${spec.range}</div>
                <div><strong>Min:</strong> ${this.config.minAngle}°</div>
                <div><strong>Max:</strong> ${this.config.maxAngle}°</div>
                <div><strong>Home Position:</strong> ${spec.home}</div>
                <div><strong>Rotation Axis:</strong> ${spec.axis}</div>
                <div><strong>Max Speed:</strong> ${spec.maxSpeed}</div>
            </div>
        `;

        return tooltip;
    }

    async init() {
        if (typeof X3D === 'undefined') {
            console.error("X3D library not loaded. Check the script tag.");
            return;
        }
        // use one pointer to X3DBrowser for all instances of this class
        if (!SliderControlledX3DElement.Browser) {
            SliderControlledX3DElement.Browser = X3D.getBrowser(this.browserSelector);
        }
        const Browser = SliderControlledX3DElement.Browser;
        if (!Browser) {
            console.error("X3DBrowser not found. Check your <x3d-canvas> element and class name. X3D=", X3D);
            return;
        }
        // Use INITIALIZED_EVENT for basic initialization
        Browser.addBrowserCallback("init", X3D.X3DConstants.INITIALIZED_EVENT, this.initEAI.bind(this));
        // If you use LoadSensor in your scene, poll for isLoaded after initialization
        // Example: DEF mySensor LoadSensor { children [ USE myInline ] }
        // Uncomment and adapt the following if you use LoadSensor:
        // setTimeout(() => this.pollLoadSensor("sceneSensor"), 100);
    }
    // Poll a LoadSensor node by DEF name until isLoaded is true, then call initEAI
    pollLoadSensor(sensorName) {
        if (!this.scene) return;
        const sensor = this.scene.getNamedNode(sensorName);
        if (!sensor) {
            console.warn(`LoadSensor '${sensorName}' not found.`);
            return;
        }
        if (sensor.isLoaded) {
            this.initEAI();
        } else {
            setTimeout(() => this.pollLoadSensor(sensorName), 100);
        }
    }

    // initEAI: Initialize the External Authoring Interface (EAI) when the X3D component is ready
    initEAI() {
        this.initEAICount++;
        if (!this.scene) this.scene = X3D.getBrowser(this.browserSelector).currentScene;
        if (!this.scene) {
            console.error("Scene not found");
            return;
        }
        try {
            // Get the PROTO instance
            const protoInstance = this.scene.getNamedNode(this.nodeName);
            if (protoInstance) {
                console.log(`Found PROTO '${this.nodeName}'`);
                
                // Access the internal Transform node named 'JointTransform' 
                // This is the actual Transform inside the PROTO
                this.axis = protoInstance;
                
                // Define rotation axes for each KUKA axis based on the WRL file
                // A1: Z-axis (0, 0, 1) - base swivel
                // A2: Y-axis (0, 1, 0) - shoulder
                // A3: Y-axis (0, 1, 0) - elbow  
                // A4: X-axis (1, 0, 0) - wrist rotation
                // A5: Y-axis (0, 1, 0) - wrist roll
                // A6: X-axis (1, 0, 0) - end effector rotation
                const axisMap = {
                    'A1': [0, 0, 1],  // Z-axis
                    'A2': [0, 1, 0],  // Y-axis (default)
                    'A3': [0, 1, 0],  // Y-axis
                    'A4': [1, 0, 0],  // X-axis
                    'A5': [0, 1, 0],  // Y-axis
                    'A6': [1, 0, 0]   // X-axis
                };
                
                const axis = axisMap[this.nodeName] || [0, 1, 0];
                this.Rot = new X3D.SFRotation(axis[0], axis[1], axis[2], 0);
                
                console.log(`${this.nodeName} rotation axis: (${axis[0]}, ${axis[1]}, ${axis[2]})`);
            }
        }
        catch (e) {
            console.error(`initEAI: Error getting node '${this.nodeName}':`, e);
        }
        console.log(`X3D scene ready, node ${this.nodeName} initialized`);
        if (this.sliderContainer) this.sliderContainer.style.display = 'block';
        if (this.status) this.status.innerHTML = "X3D." + this.nodeName + " initialized " + this.initEAICount + " times.";
        
        // Setup listener for 3D sensor interaction (delayed to ensure field is ready)
        setTimeout(() => this.setupSensorListener(), 100);
        
        // Setup 3D hover tooltip for this component (delayed more to ensure TouchSensor is ready)
        setTimeout(() => this.setup3DLinkHoverTooltip(), 500);
    }

    // Setup listener to sync slider when 3D model is directly manipulated
    setupSensorListener() {
        if (!this.axis) {
            console.warn(`Cannot setup sensor listener for ${this.nodeName}: axis not initialized`);
            return;
        }

        // Setup hover tooltip for 3D link
        this.setup3DLinkHoverTooltip();

        try {
            // Use X_ITE's addFieldCallback to listen to rotation changes
            this.axis.rotation.addFieldCallback('rotation', (value) => {
                if (!this.slider || !this.angleValue) return;
                
                // Get rotation from X3D field (SFRotation: [x, y, z, angle])
                if (!value || value.length < 4) return;
                
                const angleRad = value[3];  // Extract angle in radians
                const angleDeg = angleRad * 180 / Math.PI;
                
                // Apply HOME offset (reverse of rotate method)
                let sliderValue = angleDeg + this.homeOffset;
                
                // Clamp to slider's min/max to enforce safety limits
                const minLimit = parseFloat(this.slider.min);
                const maxLimit = parseFloat(this.slider.max);
                sliderValue = Math.max(minLimit, Math.min(maxLimit, sliderValue));
                
                // Update slider and display
                const oldValue = this.slider.value;
                this.slider.value = Math.round(sliderValue);
                
                // Only update display if value actually changed
                if (Math.abs(parseFloat(oldValue) - parseFloat(this.slider.value)) > 0.5) {
                    this.angleValue.textContent = Math.round(sliderValue) + '°';
                    console.debug(`${this.nodeName} sensor updated slider to ${Math.round(sliderValue)}°`);
                }
            });
            
            console.log(`Sensor listener active for ${this.nodeName}`);
        } catch (error) {
            console.error(`Error setting up sensor listener for ${this.nodeName}:`, error);
        }
    }

    setupSlider() {
        if (!this.slider || !this.angleValue) {
            console.error("Slider or angle value element not found for node:", this.nodeName);
            return;
        }
        this.slider.addEventListener('input', (event) => {
            const value = event.target.value;
            this.angleValue.innerHTML = this.nodeName + "=" + value + "°";
            this.rotate(value);
        });
    }

    rotate(value) {
        // Apply HOME offset: slider value - HOME offset = actual rotation
        const actualAngle = parseFloat(value) - this.homeOffset;
        const radians = actualAngle * Math.PI / 180;
        
        if (this.axis === null || this.scene === null) {
            try {
                this.initEAI();
            }
            catch (e) {
                console.error(`rotate: Error getting node '${this.nodeName}' even after reinit:`, e);
            }
        } else if (this.axis.rotation === undefined) {
            console.error(`rotate: rotation property not found on node '${this.nodeName}'`);
        }
        else {
            try {
                // Keep the original rotation axis (x, y, z) and only change the angle
                if (this.Rot && this.axis.rotation) {
                    this.Rot[3] = radians;  // Set the angle component
                    this.axis.rotation = this.Rot;
                    console.debug(`Rotating ${this.nodeName} to ${value}° (${radians} rad)`);
                }
                else {
                    console.error(`Rot or axis.rotation not initialized for ${this.nodeName}`);
                }
            }
            catch (e) {
                console.error(`rotate: Error setting rotation on node '${this.nodeName}':`, e);
            }
            if (this.status) this.status.innerHTML = `'${this.nodeName}'.rotation set to: ${value}°`;
        }
    }

    // ========================================================================
    // Static Methods for Instance Management
    // ========================================================================
    
    /**
     * Get all instances of SliderControlledX3DElement
     * @returns {Array} Array of all instances
     */
    static getAllInstances() {
        return SliderControlledX3DElement.instances;
    }

    /**
     * Find an instance by node name
     * @param {string} nodeName - The name of the node (e.g., "A1", "A2")
     * @returns {SliderControlledX3DElement|undefined} The instance or undefined
     */
    static findByNodeName(nodeName) {
        return SliderControlledX3DElement.instances.find(
            instance => instance.nodeName === nodeName
        );
    }

    /**
     * Iterate over all instances with a callback function
     * @param {Function} callback - Function to call for each instance
     */
    static forEachInstance(callback) {
        SliderControlledX3DElement.instances.forEach(callback);
    }

    /**
     * Get the count of all instances
     * @returns {number} Number of instances
     */
    static getInstanceCount() {
        return SliderControlledX3DElement.instances.length;
    }

    // ========================================================================
    // Save/Load Methods
    // ========================================================================
    
    /**
     * Save all axis angles from all instances
     * @returns {Object} Object with axis names as keys and angles as values
     */
    static saveAllAngles() {
        const savedState = {};
        
        SliderControlledX3DElement.forEachInstance(instance => {
            if (instance.slider) {
                savedState[instance.nodeName] = parseFloat(instance.slider.value);
            }
        });
        
        console.log('Saved angles:', savedState);
        return savedState;
    }

    /**
     * Save angles to browser's localStorage
     * @param {string} key - Storage key name (default: 'robotAngles')
     * @returns {boolean} True if saved successfully
     */
    static saveToLocalStorage(key = 'robotAngles') {
        try {
            const angles = SliderControlledX3DElement.saveAllAngles();
            localStorage.setItem(key, JSON.stringify(angles));
            console.log(`Saved to localStorage as '${key}'`);
            return true;
        } catch (error) {
            console.error('Error saving to localStorage:', error);
            return false;
        }
    }

    /**
     * Export angles as JSON string
     * @returns {string} JSON string of all angles
     */
    static exportAsJSON() {
        const angles = SliderControlledX3DElement.saveAllAngles();
        return JSON.stringify(angles, null, 2);
    }

    /**
     * Load angles and apply to all instances
     * @param {Object} angles - Object with axis names as keys and angles as values
     * @param {boolean} animate - Whether to animate the transition (default: false)
     * @param {number} duration - Animation duration in milliseconds (default: 1000)
     */
    static loadAllAngles(angles, animate = false, duration = 1000) {
        if (!angles || typeof angles !== 'object') {
            console.error('Invalid angles object provided');
            return;
        }

        if (animate) {
            // Animated load (smooth transition like reset button)
            const animationDuration = duration;
            const startTime = Date.now();
            
            // Store starting positions
            const startPositions = {};
            SliderControlledX3DElement.forEachInstance(instance => {
                if (instance.slider) {
                    startPositions[instance.nodeName] = parseFloat(instance.slider.value);
                }
            });

            function animateLoad() {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / animationDuration, 1);
                
                // Ease-in-out function
                const easeProgress = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

                // Update each axis
                SliderControlledX3DElement.forEachInstance(instance => {
                    if (instance.slider && angles[instance.nodeName] !== undefined) {
                        const targetAngle = angles[instance.nodeName];
                        const startAngle = startPositions[instance.nodeName];
                        const currentValue = startAngle + (targetAngle - startAngle) * easeProgress;
                        
                        instance.slider.value = currentValue;
                        instance.slider.dispatchEvent(new Event('input'));
                        
                        if (instance.angleValue) {
                            instance.angleValue.textContent = Math.round(currentValue) + '°';
                        }
                    }
                });

                // Continue animation if not complete
                if (progress < 1) {
                    requestAnimationFrame(animateLoad);
                } else {
                    console.log('Loaded angles:', angles);
                }
            }

            animateLoad();
        } else {
            // Instant load (no animation)
            SliderControlledX3DElement.forEachInstance(instance => {
                if (angles[instance.nodeName] !== undefined && instance.slider) {
                    const angle = angles[instance.nodeName];
                    instance.slider.value = angle;
                    instance.slider.dispatchEvent(new Event('input'));
                    
                    if (instance.angleValue) {
                        instance.angleValue.textContent = angle + '°';
                    }
                }
            });
            console.log('Loaded angles:', angles);
        }
    }

    /**
     * Load angles from browser's localStorage
     * @param {string} key - Storage key name (default: 'robotAngles')
     * @param {boolean} animate - Whether to animate the transition
     * @param {number} duration - Animation duration in milliseconds (default: 1000)
     * @returns {boolean} True if loaded successfully, false otherwise
     */
    static loadFromLocalStorage(key = 'robotAngles', animate = false, duration = 1000) {
        const savedData = localStorage.getItem(key);
        
        if (!savedData) {
            console.warn(`No saved data found in localStorage with key '${key}'`);
            return false;
        }

        try {
            const angles = JSON.parse(savedData);
            SliderControlledX3DElement.loadAllAngles(angles, animate, duration);
            console.log(`Loaded from localStorage '${key}'`);
            return true;
        } catch (error) {
            console.error('Error parsing saved data:', error);
            return false;
        }
    }

    /**
     * Import angles from JSON string
     * @param {string} jsonString - JSON string containing angles
     * @param {boolean} animate - Whether to animate the transition
     * @returns {boolean} True if imported successfully, false otherwise
     */
    static importFromJSON(jsonString, animate = false) {
        try {
            const angles = JSON.parse(jsonString);
            SliderControlledX3DElement.loadAllAngles(angles, animate);
            console.log('Imported angles from JSON');
            return true;
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return false;
        }
    }

    /**
     * Save configuration with a custom name
     * @param {string} configName - Name for this configuration
     * @returns {boolean} True if saved successfully
     */
    static saveNamedConfig(configName) {
        if (!configName || configName.trim() === '') {
            console.error('Configuration name cannot be empty');
            return false;
        }

        try {
            const angles = SliderControlledX3DElement.saveAllAngles();
            const configKey = `robotConfig_${configName}`;
            localStorage.setItem(configKey, JSON.stringify(angles));
            
            // Update config list
            const configList = SliderControlledX3DElement.getConfigList();
            if (!configList.includes(configName)) {
                configList.push(configName);
                localStorage.setItem('robotConfigList', JSON.stringify(configList));
            }
            
            console.log(`Saved configuration '${configName}'`);
            return true;
        } catch (error) {
            console.error('Error saving named config:', error);
            return false;
        }
    }

    /**
     * Load configuration by name
     * @param {string} configName - Name of configuration to load
     * @param {boolean} animate - Whether to animate the transition
     * @param {number} duration - Animation duration in milliseconds
     * @returns {boolean} True if loaded successfully
     */
    static loadNamedConfig(configName, animate = false, duration = 1000) {
        const configKey = `robotConfig_${configName}`;
        const savedData = localStorage.getItem(configKey);
        
        if (!savedData) {
            console.warn(`Configuration '${configName}' not found`);
            return false;
        }

        try {
            const angles = JSON.parse(savedData);
            SliderControlledX3DElement.loadAllAngles(angles, animate, duration);
            console.log(`Loaded configuration '${configName}'`);
            return true;
        } catch (error) {
            console.error('Error loading named config:', error);
            return false;
        }
    }

    /**
     * Get list of all saved configuration names
     * @returns {Array<string>} Array of configuration names
     */
    static getConfigList() {
        try {
            const listData = localStorage.getItem('robotConfigList');
            return listData ? JSON.parse(listData) : [];
        } catch (error) {
            console.error('Error reading config list:', error);
            return [];
        }
    }

    /**
     * Delete a saved configuration
     * @param {string} configName - Name of configuration to delete
     * @returns {boolean} True if deleted successfully
     */
    static deleteNamedConfig(configName) {
        try {
            const configKey = `robotConfig_${configName}`;
            localStorage.removeItem(configKey);
            
            // Update config list
            const configList = SliderControlledX3DElement.getConfigList();
            const updatedList = configList.filter(name => name !== configName);
            localStorage.setItem('robotConfigList', JSON.stringify(updatedList));
            
            console.log(`Deleted configuration '${configName}'`);
            return true;
        } catch (error) {
            console.error('Error deleting config:', error);
            return false;
        }
    }

    /**
     * Get all saved configurations with their data
     * @returns {Object} Object with config names as keys and angle data as values
     */
    static getAllConfigs() {
        const configList = SliderControlledX3DElement.getConfigList();
        const allConfigs = {};
        
        configList.forEach(name => {
            const configKey = `robotConfig_${name}`;
            const data = localStorage.getItem(configKey);
            if (data) {
                try {
                    allConfigs[name] = JSON.parse(data);
                } catch (error) {
                    console.error(`Error parsing config '${name}':`, error);
                }
            }
        });
        
        return allConfigs;
    }

    /**
     * Setup hover tooltips for non-joint components (Gripper, AdapterFlange, Finger, Base)
     * This static method should be called after the scene is fully loaded
     */
    static setupAdditionalComponentTooltips() {
        const browser = X3D.getBrowser('.X3D');
        if (!browser || !browser.currentScene) {
            console.warn('Scene not ready for additional component tooltips');
            return;
        }
        
        const scene = browser.currentScene;
        const tooltipOverlay = document.getElementById('link-tooltip-overlay');
        const canvas = document.querySelector('.X3D');
        
        if (!tooltipOverlay || !canvas) {
            console.warn('Tooltip overlay or canvas not found');
            return;
        }

        // Component specs for tooltips
        const componentSpecs = {
            'Gripper': {
                description: 'SCHUNK EGP 40 Gripper',
                type: 'Parallel Gripper',
                stroke: '40mm',
                gripForce: '140N',
                weight: '0.45kg',
                function: 'Pneumatic parallel gripper for parts handling',
                manufacturer: 'SCHUNK'
            },
            'AdapterFlange': {
                description: 'Adapter Flange',
                type: 'Mechanical Interface',
                function: 'Connects robot flange to gripper',
                material: 'Aluminum alloy',
                weight: '0.2kg'
            },
            'Base': {
                description: 'Robot Base',
                type: 'Mounting Platform',
                function: 'Provides stable mounting surface for the robot',
                weight: '12kg',
                material: 'Cast iron',
                mountingHoles: 'ISO 9409-1'
            }
        };

        // Component TouchSensor names (external TouchSensors)
        const componentSensors = {
            'Gripper': 'Gripper_TouchSensor',
            'AdapterFlange': 'AdapterFlange_TouchSensor',
            'Base': 'Base_TouchSensor'
        };
        
        Object.keys(componentSensors).forEach(componentName => {
            try {
                const touchSensorName = componentSensors[componentName];
                let touchSensor = null;
                
                // Try to get the TouchSensor directly first (works for Base which is at scene root)
                try {
                    touchSensor = scene.getNamedNode(touchSensorName);
                    if (touchSensor) {
                        console.log(`Found ${touchSensorName} at scene level`);
                    }
                } catch (e) {
                    // Not found at scene level
                    console.log(`${touchSensorName} not at scene level: ${e.message}`);
                }
                
                // If not found and not Base, search through A6's children (since Gripper and AdapterFlange are children of A6)
                // Base is at scene root, so we don't search for it in A6
                if (!touchSensor && componentName !== 'Base') {
                    try {
                        const a6Node = scene.getNamedNode('A6');
                        if (a6Node) {
                            console.log(`Found A6, searching its children for ${touchSensorName}`);
                            
                            // Recursive search function that checks DEF names properly
                            const searchNode = (node, targetName, depth = 0) => {
                                // Check various name properties
                                const nodeName = node._name || node.name || (node.getNodeName && node.getNodeName());
                                if (nodeName === targetName) {
                                    console.log(`  Found ${targetName} at depth ${depth}`);
                                    return node;
                                }
                                
                                // Search in children arrays
                                const childrenArrays = [node._children, node.children];
                                for (const childArray of childrenArrays) {
                                    if (childArray && childArray.length > 0) {
                                        for (const child of childArray) {
                                            const found = searchNode(child, targetName, depth + 1);
                                            if (found) return found;
                                        }
                                    }
                                }
                                
                                // Search in MFNode fields (like children field)
                                if (node.getFieldDefinitions) {
                                    try {
                                        const childrenField = node.getField && node.getField('children');
                                        if (childrenField && childrenField.length > 0) {
                                            for (let i = 0; i < childrenField.length; i++) {
                                                const child = childrenField[i];
                                                const found = searchNode(child, targetName, depth + 1);
                                                if (found) return found;
                                            }
                                        }
                                    } catch (e) {
                                        // No children field
                                    }
                                }
                                
                                return null;
                            };
                            
                            touchSensor = searchNode(a6Node, touchSensorName);
                        }
                    } catch (e) {
                        console.log(`Error searching A6:`, e.message);
                    }
                }
                
                if (touchSensor && touchSensor.isOver) {
                    console.log(`✓ Found TouchSensor for ${componentName}`);
                    
                    const spec = componentSpecs[componentName];
                    touchSensor.isOver.addFieldCallback(`hover_${componentName}`, (isOver) => {
                        if (isOver && spec) {
                            let tooltipContent = `<div class="link-title">${componentName} - ${spec.description}</div><div class="link-info">`;
                            tooltipContent += `<div><strong>Type:</strong> ${spec.type}</div>`;
                            tooltipContent += `<div><strong>Function:</strong> ${spec.function}</div>`;
                            if (spec.weight) tooltipContent += `<div><strong>Weight:</strong> ${spec.weight}</div>`;
                            if (spec.material) tooltipContent += `<div><strong>Material:</strong> ${spec.material}</div>`;
                            if (spec.manufacturer) tooltipContent += `<div><strong>Manufacturer:</strong> ${spec.manufacturer}</div>`;
                            if (spec.stroke) tooltipContent += `<div><strong>Stroke:</strong> ${spec.stroke}</div>`;
                            if (spec.gripForce) tooltipContent += `<div><strong>Grip Force:</strong> ${spec.gripForce}</div>`;
                            tooltipContent += `</div>`;
                            
                            tooltipOverlay.innerHTML = tooltipContent;
                            tooltipOverlay.classList.add('visible');
                            tooltipOverlay.dataset.activeComponent = componentName;
                        } else if (tooltipOverlay.dataset.activeComponent === componentName) {
                            tooltipOverlay.classList.remove('visible');
                            tooltipOverlay.dataset.activeComponent = '';
                        }
                    });
                    
                    console.log(`✓ Tooltip enabled for ${componentName}`);
                } else {
                    console.warn(`TouchSensor ${touchSensorName} not found for ${componentName}`);
                }
            } catch (e) {
                console.warn(`Could not setup tooltip for ${componentName}:`, e.message);
            }
        });
    }

}

// Export to global scope
window.SliderControlledX3DElement = SliderControlledX3DElement;

})();
