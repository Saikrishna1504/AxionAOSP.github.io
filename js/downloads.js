/**
 * Main entry point - runs when DOM is fully loaded
 * Handles device data fetching, processing, and UI rendering
 */
document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.querySelector('.downloads-grid');
  const loading = document.querySelector('.loading-state');

  try {
    loading.style.display = 'flex';

    const CACHE_EXPIRY = 1800000; // 30 minutes
    const cachedData = checkCache('device_data');

    let devices, imagesData;

    if (cachedData) {
      ({ devices, imagesData } = cachedData);
    } else {
      const [devicesRes, imagesRes] = await Promise.all([
        fetch('https://raw.githubusercontent.com/AxionAOSP/official_devices/refs/heads/main/README.md'),
        fetch('https://raw.githubusercontent.com/AxionAOSP/official_devices/refs/heads/main/OTA/device_images.json')
      ]);

      const [devicesText, images] = await Promise.all([
        devicesRes.text(),
        imagesRes.json()
      ]);

      devices = processDevices(devicesText);
      imagesData = images;
      saveToCache('device_data', { devices, imagesData });
    }

    const deviceElements = await createDeviceElements(devices, imagesData);
    deviceElements.forEach(element => {
      element.style.display = 'none';
      grid.appendChild(element);
    });

    initFilters();
    initSearch();
    initModalLogic();

  } catch (error) {
    console.error('Error:', error);
    grid.innerHTML = `
      <div class="error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load devices. Please check the 
           <a href="https://github.com/AxionAOSP/official_devices" target="_blank">official repository</a>.
        </p>
      </div>
    `;
  } finally {
    loading.style.display = 'none';
  }
});

function initSearch() {
  const searchInput = document.getElementById('deviceSearch');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    const deviceCards = document.querySelectorAll('.device-card');

    deviceCards.forEach(card => {
      const name = card.querySelector('.device-name').textContent.toLowerCase();
      const codename = card.querySelector('.codename').textContent.toLowerCase();
      
      if ((name.includes(query) || codename.includes(query)) && query !== '') {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  });
}

/* ======================
   CACHE MANAGEMENT
   ====================== */

/**
 * Checks if valid cached data exists
 * @param {string} key - Local storage key
 * @returns {object|null} Cached data or null
 */
function checkCache(key) {
  const cached = localStorage.getItem(key);
  if (!cached) return null;

  try {
    const { timestamp, data } = JSON.parse(cached);
    const CACHE_EXPIRY = 1800000; // 30 minutes
    return Date.now() - timestamp < CACHE_EXPIRY ? data : null;
  } catch (e) {
    return null;
  }
}

/**
 * Saves data to local storage with timestamp
 * @param {string} key - Storage key
 * @param {object} data - Data to cache
 */
function saveToCache(key, data) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        timestamp: Date.now(),
        data,
      })
    );
  } catch (e) {
    console.warn('Failed to cache data:', e);
  }
}

/* ======================
   DATA PROCESSING
   ====================== */

/**
 * Parses device data from README Markdown table
 * @param {string} text - README content
 * @returns {Array} Processed device list
 */
function processDevices(text) {
  try {
    // Extract devices table section
    const tableSection = text
      .split('# 📱 Supported Devices')[1]
      .split('## 👤 Maintainers')[0];

    return tableSection
      .split('\n')
      .filter(line => line.startsWith('|') && !line.includes('--'))
      .slice(2) // Skip header rows
      .map(line => {
        const [, name, codename] = line.split('|').map(c => c.trim());
        return {
          name: name.replace(/\*\*/g, ''), // Remove markdown bold
          codename: codename.replace(/`/g, ''), // Remove code formatting
          brand: getDeviceBrand(name), // Determine device brand
        };
      });
  } catch (error) {
    console.error('Error processing devices:', error);
    return [];
  }
}

/**
 * Creates device card elements with lazy-loaded images
 * @param {Array} devices - Processed device list
 * @param {object} imagesData - Device image URLs
 * @returns {Promise<Array>} Array of device card elements
 */
function createDeviceElements(devices, imagesData) {
  return Promise.all(
    devices.map(async (device) => {
      const element = document.createElement('div');
      element.className = 'device-card';
      element.dataset.brand = device.brand; // For filtering

      // Fetch build flavors (GMS/Vanilla)
      const [gms, vanilla] = await Promise.all([
        fetchFlavorDataWithCache(device.codename, 'GMS'),
        fetchFlavorDataWithCache(device.codename, 'VANILLA'),
      ]);

      // Get device image or fallback
      const imageInfo = imagesData.devices.find(d => d.codename === device.codename);
      const imageUrl = imageInfo?.imageUrl || 'img/fallback.png';

      // Generate flavor HTML for modal
      const flavorHtml = `
        ${gms ? renderFlavor('GMS', gms) : ''}
        ${vanilla ? renderFlavor('Vanilla', vanilla) : ''}
      `;

      // Build device card HTML
      element.innerHTML = `
      <div class="device-header" data-flavors="${encodeURIComponent(flavorHtml)}">
        <img 
          src="${imageUrl}"
          class="device-thumb"
          alt="${device.name}"
          loading="lazy"
          onerror="this.src='img/fallback.png'"
        />
        <div class="device-info">
          <div class="device-name">${device.name}</div>
          <div class="codename">${device.codename}</div>
        </div>
      </div>
    `;    

      return element;
    })
  );
}

/* ======================
   FLAVOR DATA HANDLING
   ====================== */

const flavorCache = new Map(); // In-memory cache for flavor data

/**
 * Fetches flavor data with caching
 * @param {string} codename - Device codename
 * @param {string} type - Flavor type (GMS/VANILLA)
 * @returns {Promise<object|null>} Flavor data or null
 */
async function fetchFlavorDataWithCache(codename, type) {
  const cacheKey = `${codename}_${type}`;

  // Return cached data if available
  if (flavorCache.has(cacheKey)) {
    return flavorCache.get(cacheKey);
  }

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/AxionAOSP/official_devices/main/OTA/${type}/${codename.toLowerCase()}.json`
    );
    if (!res.ok) return null;
    
    const data = await res.json();
    const result = data.response[0] || null;
    
    // Update cache
    flavorCache.set(cacheKey, result);
    return result;
  } catch {
    flavorCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Generates HTML for a build flavor
 * @param {string} type - Flavor type
 * @param {object} data - Flavor data
 * @returns {string} HTML string
 */
function renderFlavor(type, data) {
  if (!data) return '';

  // Format data values
  const sizeMB = (data.size / 1024 / 1024).toFixed(1);
  const buildDate = new Date(data.datetime * 1000).toLocaleDateString();

  return `
    <div class="flavor-card">
      <div class="flavor-header">
        <div class="flavor-title">${type}</div>
        <a href="${data.url}" class="download-btn" download target="_blank" download>
          <i class="fas fa-download"></i> ${sizeMB}MB
        </a>
      </div>
      <div class="version-info">
        <div>Version: ${data.version}</div>
        <div>Build Date: ${buildDate}</div>
        <div>File: ${data.filename}</div>
      </div>
    </div>
  `;
}

/* ======================
   UI INTERACTIONS
   ====================== */

/**
 * Initializes modal dialog for flavor details
 */
function initModalLogic() {
  const modalOverlay = document.getElementById('modalOverlay');
  const modalBody = document.getElementById('modalBody');
  const closeModalBtn = document.getElementById('closeModalBtn');

  // Show modal on device card click
  document.querySelector('.downloads-grid').addEventListener('click', (event) => {
    const deviceHeader = event.target.closest('.device-header');
    if (!deviceHeader) return;
  
    const flavorsData = deviceHeader.dataset.flavors;
    if (!flavorsData) return;
  
    modalBody.innerHTML = decodeURIComponent(flavorsData);
    modalOverlay.classList.add('active');
  });

  // Close modal handlers
  closeModalBtn.addEventListener('click', () => closeModal());
  modalOverlay.addEventListener('click', (e) => e.target === modalOverlay && closeModal());

  function closeModal() {
    modalOverlay.classList.remove('active');
    modalBody.innerHTML = '';
  }
}

/**
 * Initializes brand filtering buttons
 */
function initFilters() {
  document.querySelector('.filter-container').addEventListener('click', (event) => {
    const btn = event.target.closest('.filter-btn');
    if (!btn) return;

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    document.querySelectorAll('.device-card').forEach(card => {
      card.style.display = card.dataset.brand === filter ? 'block' : 'none';
    });
  });
}

/* ======================
   UTILITIES
   ====================== */

const brandCache = new Map(); // Cache for brand detection

/**
 * Determines device brand from name
 * @param {string} deviceName - Full device name
 * @returns {string} Brand identifier
 */
function getDeviceBrand(deviceName) {
  if (brandCache.has(deviceName)) {
    return brandCache.get(deviceName);
  }

  // Brand detection patterns
  const brands = {
    google: /Google Pixel/i,
    samsung: /Galaxy/i,
    poco: /POCO/i,
    realme: /Realme/i,
    xiaomi: /Xiaomi|Redmi/i,
    tecno: /TECNO/i,
    motorola: /Motorola/i,
  };  

  const brand = Object.entries(brands).find(([_, regex]) => 
    regex.test(deviceName)
  )?.[0] || 'other';

  brandCache.set(deviceName, brand);
  return brand;
            }
