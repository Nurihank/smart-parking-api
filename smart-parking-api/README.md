# Smart Parking API - MQTT & ESP32 Entegrasyonu

## MQTT Broker Ayarları

- **Broker URL**: `mqtt://localhost:1883` (varsayılan)
- **Client ID**: `parking-api-{random}`
- **Keep Alive**: 60 saniye
- **Reconnect Period**: 5 saniye

## MQTT Topic Yapısı

### ESP32'den API'ye Mesajlar (Subscribe)

#### 1. Araç Tespit Edildi

```
Topic: parking/spot/{spot_id}/vehicle/detected
Payload: {
  "sensor_id": "ESP32_001",
  "spot_id": 1,
  "timestamp": "2025-11-25T10:30:00.000Z",
  "sensor_value": 15.5,
  "confidence": 0.95
}
```

#### 2. Araç Ayrıldı

```
Topic: parking/spot/{spot_id}/vehicle/left
Payload: {
  "sensor_id": "ESP32_001",
  "spot_id": 1,
  "timestamp": "2025-11-25T11:45:00.000Z",
  "sensor_value": 85.2,
  "confidence": 0.98
}
```

#### 3. Spot Durumu

```
Topic: parking/spot/{spot_id}/status
Payload: {
  "sensor_id": "ESP32_001",
  "spot_id": 1,
  "status": "occupied", // "occupied", "free", "error"
  "timestamp": "2025-11-25T10:30:00.000Z"
}
```

### API'den ESP32'ye Mesajlar (Publish)

#### 1. Araç Gelişi Onayı

```
Topic: parking/spot/{spot_id}/confirmation
Payload: {
  "status": "vehicle_arrived",
  "reservation_id": 123,
  "timestamp": "2025-11-25T10:30:05.000Z",
  "message": "Araç gelişi kaydedildi"
}
```

#### 2. Araç Ayrılış Onayı

```
Topic: parking/spot/{spot_id}/confirmation
Payload: {
  "status": "vehicle_left",
  "reservation_id": 123,
  "timestamp": "2025-11-25T11:45:05.000Z",
  "message": "Araç ayrılışı kaydedildi"
}
```

#### 3. Uyarı Mesajları

```
Topic: parking/spot/{spot_id}/warning
Payload: {
  "status": "no_reservation",
  "message": "Bu spot için aktif rezervasyon bulunmamaktadır",
  "timestamp": "2025-11-25T10:30:05.000Z",
  "action": "ignore" // "ignore", "alert", "report"
}
```

## API Endpoints

### Rezervasyon Endpoint'leri

#### 1. Yeni Rezervasyon Oluştur

```http
POST /api/reservations
Content-Type: application/json

{
  "user_id": 1,
  "spot_id": 1,
  "vehicle_id": 1
}
```

#### 2. Araç Geldi (MQTT'den otomatik)

```http
PUT /api/reservations/{reservation_id}/vehicle-arrived
Content-Type: application/json

{
  "spot_id": 1
}
```

#### 3. Araç Ayrıldı (MQTT'den otomatik)

```http
PUT /api/reservations/{reservation_id}/vehicle-left
Content-Type: application/json

{
  "spot_id": 1
}
```

#### 4. Rezervasyon İptal

```http
PUT /api/reservations/{reservation_id}/cancel
```

#### 5. Süresi Dolan Rezervasyonları Kontrol Et (Otomatik - 2dk'da bir)

```http
POST /api/reservations/check-expired
```

#### 6. Aktif Rezervasyonları Listele

```http
GET /api/reservations/active
```

#### 7. Kullanıcı Rezervasyon Geçmişi

```http
GET /api/reservations/user/{user_id}
```

#### 8. Park Yeri Durumları

```http
GET /api/parking-spots/status
```

### Sistem Endpoint'leri

#### 1. Sistem Durumu

```http
GET /api/system/status
```

#### 2. Manuel Rezervasyon Kontrolü

```http
POST /api/system/check-reservations
```

#### 3. MQTT Test

```http
POST /api/system/mqtt/test
Content-Type: application/json

{
  "topic": "parking/spot/1/vehicle/detected",
  "message": {
    "sensor_id": "TEST",
    "spot_id": 1,
    "timestamp": "2025-11-25T10:30:00.000Z"
  }
}
```

## Sistem Akışı

### 1. Rezervasyon Akışı

1. **Mobil Uygulama** → POST `/api/reservations` → Rezervasyon oluştur
2. **Sistem** → Park yerini "Rezerve" durumuna getir
3. **Sistem** → 10 dakika bekleme süresi başlar
4. **ESP32** → Araç sensörü tetiklenirse MQTT mesajı gönder
5. **API** → MQTT mesajını alır ve rezervasyonu günceller
6. **Sistem** → Park yerini "Dolu" durumuna getir

### 2. Araç Ayrılış Akışı

1. **ESP32** → Araç ayrıldı mesajı gönder
2. **API** → Rezervasyonu "Bitti" durumuna getir
3. **Sistem** → Park yerini "Boş" durumuna getir

### 3. Zaman Aşımı Akışı

1. **Cron Job** → Her 2 dakikada bir kontrol et
2. **Sistem** → 10 dakika geçen rezervasyonları bul
3. **Sistem** → Rezervasyonları "İptalEdildi" durumuna getir
4. **Sistem** → Park yerlerini "Boş" durumuna getir

## ESP32 Kod Örneği

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* ssid = "your_wifi";
const char* password = "your_password";
const char* mqtt_server = "your_mqtt_broker_ip";

WiFiClient espClient;
PubSubClient client(espClient);

const int SPOT_ID = 1;
const int TRIG_PIN = 2;
const int ECHO_PIN = 3;

void setup() {
  Serial.begin(115200);

  // WiFi bağlantısı
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // MQTT bağlantısı
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Sensör okuma
  long distance = readUltrasonicDistance();

  static bool vehiclePresent = false;
  static bool lastVehicleState = false;

  // Araç varlığını kontrol et (örnek: 20cm'den az mesafe = araç var)
  vehiclePresent = (distance < 20);

  // Durum değişikliği varsa MQTT mesajı gönder
  if (vehiclePresent != lastVehicleState) {
    if (vehiclePresent) {
      sendVehicleDetected();
    } else {
      sendVehicleLeft();
    }
    lastVehicleState = vehiclePresent;
  }

  delay(2000); // 2 saniye bekle
}

void sendVehicleDetected() {
  StaticJsonDocument<200> doc;
  doc["sensor_id"] = "ESP32_001";
  doc["spot_id"] = SPOT_ID;
  doc["timestamp"] = getTimestamp();
  doc["sensor_value"] = readUltrasonicDistance();
  doc["confidence"] = 0.95;

  char buffer[200];
  serializeJson(doc, buffer);

  String topic = "parking/spot/" + String(SPOT_ID) + "/vehicle/detected";
  client.publish(topic.c_str(), buffer);

  Serial.println("Araç tespit edildi mesajı gönderildi");
}

void sendVehicleLeft() {
  StaticJsonDocument<200> doc;
  doc["sensor_id"] = "ESP32_001";
  doc["spot_id"] = SPOT_ID;
  doc["timestamp"] = getTimestamp();
  doc["sensor_value"] = readUltrasonicDistance();
  doc["confidence"] = 0.98;

  char buffer[200];
  serializeJson(doc, buffer);

  String topic = "parking/spot/" + String(SPOT_ID) + "/vehicle/left";
  client.publish(topic.c_str(), buffer);

  Serial.println("Araç ayrıldı mesajı gönderildi");
}

long readUltrasonicDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  long distance = duration * 0.034 / 2;

  return distance;
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("MQTT mesajı alındı: ");
  Serial.println(topic);

  // API'den gelen onay mesajlarını işle
  String message;
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println("Payload: " + message);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect("ESP32Client")) {
      // Confirmation topic'lerine abone ol
      String confirmTopic = "parking/spot/" + String(SPOT_ID) + "/confirmation";
      String warningTopic = "parking/spot/" + String(SPOT_ID) + "/warning";

      client.subscribe(confirmTopic.c_str());
      client.subscribe(warningTopic.c_str());

      Serial.println("MQTT'ye bağlanıldı");
    } else {
      delay(5000);
    }
  }
}

String getTimestamp() {
  // NTP ile gerçek zaman alınabilir
  // Şimdilik basit timestamp
  return String(millis());
}
```

## Kurulum

### Gerekli Paketleri Yükle

```bash
npm install node-cron mqtt node-fetch
```

### MQTT Broker Kurulumu (Windows)

1. Eclipse Mosquitto MQTT Broker'ı indirin
2. Kurulum yapın ve servisi başlatın
3. Varsayılan port: 1883

### Servisi Başlatma

```bash
npm start
```

## Test

### MQTT Test (Mosquitto Client ile)

```bash
# Mesaj gönder
mosquitto_pub -h localhost -t "parking/spot/1/vehicle/detected" -m '{"sensor_id":"TEST","spot_id":1,"timestamp":"2025-11-25T10:30:00.000Z"}'

# Mesaj dinle
mosquitto_sub -h localhost -t "parking/spot/+/confirmation"
```

Bu sistem ile ESP32'ler MQTT üzerinden API ile iletişim kuracak, otomatik rezervasyon kontrolleri yapılacak ve park yeri durumları gerçek zamanlı olarak güncellenecektir.
