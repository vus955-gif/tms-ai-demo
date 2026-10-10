import { addTimelineEntries } from "@/simulation/scenario/timeline";

/** Stage 1 scripted incidents (spec §10.2). */
addTimelineEntries([
  {
    atMin: 20,
    type: "incident.start",
    payload: {
      id: "inc-a2",
      kind: "traffic_accident",
      title: "Wypadek na A2 przed Świeckiem",
      description: "Zderzenie dwóch ciężarówek, ruch jednym pasem w kierunku granicy.",
      lat: 52.33,
      lng: 14.7,
      radiusM: 6000,
      speedFactor: 0.05,
      durationMin: 180,
      alternativeRouteKey: "alt__a2-kostrzyn",
    },
  },
  {
    atMin: 90,
    type: "incident.start",
    payload: {
      id: "inc-ramp",
      kind: "ramp_wait",
      title: "Długie oczekiwanie na rampie",
      description: "Baltic Foods w Pruszczu: opóźniony załadunek, rampy zajęte.",
      vehicleId: "v-gd2m88",
      extraMinutes: 120,
    },
  },
  {
    atMin: 240,
    type: "incident.start",
    payload: {
      id: "inc-breakdown",
      kind: "breakdown",
      title: "Awaria — przebita opona",
      description: "Kierowca zgłasza przebitą oponę, czeka na serwis mobilny.",
      vehicleId: "v-wx9t04",
      extraMinutes: 90,
    },
  },
  {
    atMin: 280,
    type: "incident.start",
    payload: {
      id: "inc-check",
      kind: "road_check",
      title: "Kontrola drogowa ITD",
      description: "Kontrola tachografu i dokumentów przewozowych.",
      vehicleId: "v-wb6p77",
      extraMinutes: 40,
    },
  },
]);
