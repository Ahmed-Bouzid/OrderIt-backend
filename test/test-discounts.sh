#!/bin/bash

# 🧪 Script de test pour les réductions à l'encaissement
# Usage: ./test-discounts.sh

# Configuration
BASE_URL="http://localhost:5000"  # Adapter selon l'environnement
SESSION_ID="REMPLACER_PAR_UN_ID_DE_SESSION_VALIDE"
ORDER_ID="REMPLACER_PAR_UN_ID_DE_ORDER_VALIDE"

# Se connecter et obtenir un token
echo "📝 1. Login..."
TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }' | jq -r '.token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Erreur de login"
  exit 1
fi

echo "✅ Token obtenu : ${TOKEN:0:20}..."

# Test 1 : Encaissement sans réduction
echo ""
echo "🧪 2. Test : Encaissement sans réduction"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "cash"
  }' | jq '.'

# Test 2 : Réduction de 10%
echo ""
echo "🧪 3. Test : Réduction de 10% (geste commercial)"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "cash",
    "discounts": [
      {
        "type": "percentage",
        "value": 10,
        "reason": "geste_commercial"
      }
    ]
  }' | jq '{
    pricing: .pricing,
    discounts: .discounts,
    totalAmount: .totalAmount
  }'

# Test 3 : Réduction fixe de 5€
echo ""
echo "🧪 4. Test : Réduction fixe de 5€ (anniversaire)"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "card_offline",
    "discounts": [
      {
        "type": "fixed_amount",
        "value": 5,
        "reason": "anniversaire"
      }
    ]
  }' | jq '{
    pricing: .pricing,
    discounts: .discounts
  }'

# Test 4 : Suppression d'un plat
echo ""
echo "🧪 5. Test : Suppression d'un plat (erreur cuisine)"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"paymentMethod\": \"cash\",
    \"discounts\": [
      {
        \"type\": \"item_removal\",
        \"value\": 0,
        \"reason\": \"erreur_cuisine\",
        \"orderId\": \"$ORDER_ID\",
        \"itemIndex\": 0
      }
    ]
  }" | jq '{
    pricing: .pricing,
    discounts: .discounts
  }'

# Test 5 : Combinaison de réductions
echo ""
echo "🧪 6. Test : Combinaison de réductions"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"paymentMethod\": \"cash\",
    \"discounts\": [
      {
        \"type\": \"item_removal\",
        \"value\": 0,
        \"reason\": \"erreur_service\",
        \"orderId\": \"$ORDER_ID\",
        \"itemIndex\": 1
      },
      {
        \"type\": \"percentage\",
        \"value\": 15,
        \"reason\": \"geste_commercial\"
      },
      {
        \"type\": \"fixed_amount\",
        \"value\": 2,
        \"reason\": \"compensation\"
      }
    ]
  }" | jq '{
    pricing: .pricing,
    discounts: .discounts
  }'

# Test 6 : Validation - Pourcentage > 100 (devrait échouer)
echo ""
echo "🧪 7. Test : Validation - Pourcentage > 100 (doit échouer)"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "cash",
    "discounts": [
      {
        "type": "percentage",
        "value": 150,
        "reason": "geste_commercial"
      }
    ]
  }' | jq '.'

# Test 7 : Validation - item_removal sans orderId (devrait échouer)
echo ""
echo "🧪 8. Test : Validation - item_removal sans orderId (doit échouer)"
curl -s -X PATCH "$BASE_URL/counter/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethod": "cash",
    "discounts": [
      {
        "type": "item_removal",
        "value": 0,
        "reason": "erreur_cuisine",
        "itemIndex": 0
      }
    ]
  }' | jq '.'

echo ""
echo "✅ Tests terminés"
