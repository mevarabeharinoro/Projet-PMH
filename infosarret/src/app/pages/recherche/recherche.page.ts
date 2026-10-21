import {
  Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonItem, IonLabel,
  IonSelect, IonSelectOption, IonButton, IonIcon, ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { locateOutline, searchOutline } from 'ionicons/icons';
import { Geolocation } from '@capacitor/geolocation';
import * as L from 'leaflet';
import { ArretService } from '../../services/arret.service';

@Component({
  selector: 'app-recherche',
  templateUrl: './recherche.page.html',
  styleUrls: ['./recherche.page.scss'],
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonItem, IonLabel,
    IonSelect, IonSelectOption, IonButton, IonIcon,
  ],
})
export class RecherchePage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('carte') carteEl!: ElementRef<HTMLDivElement>;

  zones: any[] = [];
  zoneOrigineId: number | null = null;
  messageZone: string | null = null;
  nbBusZone = 0;
  position: { lat: number; lon: number } | null = null;

  zoneDestId: number | null = null;
  arretsDest: any[] = [];
  arretDestId: number | null = null;

  resultats: any[] = [];
  messageResultat: string | null = null;
  recherchEffectuee = false;
  retoursEnvoyes = new Set<number>();

  private carte!: L.Map;
  private couchesZones = new Map<number, L.GeoJSON>();
  private groupeDest = L.layerGroup();
  private groupeMontee = L.layerGroup();
  private marqueursDest = new Map<number, L.CircleMarker>();
  private marqueursBus = new Map<number, L.Marker>();
  private etaInitiale = new Map<number, number>();
  private maPosition?: L.CircleMarker;
  private minuteur: any = null;

  constructor(
    private api: ArretService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ locateOutline, searchOutline });
  }

  ngOnInit() {
    this.api.getZones().subscribe({
      next: (z) => {
        this.zones = z;
        this.cdr.markForCheck();
      },
    });
  }

  ngAfterViewInit() {
    this.carte = L.map(this.carteEl.nativeElement).setView([-20.2415, 57.465], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.carte);
    this.groupeDest.addTo(this.carte);
    this.groupeMontee.addTo(this.carte);
    setTimeout(() => this.carte.invalidateSize(), 300);

    this.api.getZonesGeojson().subscribe({
      next: (fc) => {
        this.dessinerZones(fc);
        this.localiser();
      },
    });
  }

  ionViewDidEnter() {
    setTimeout(() => this.carte?.invalidateSize(), 100);
    if (this.zoneOrigineId && !this.minuteur) {
      this.rafraichir();
      this.minuteur = setInterval(() => this.rafraichir(), 3000);
    }
  }

  ionViewWillLeave() {
    this.arreterRafraichissement();
  }

  ngOnDestroy() {
    this.arreterRafraichissement();
    this.carte?.remove();
  }

  // ----- Zones -----

  private styleZone(id: number): L.PathOptions {
    if (id === this.zoneOrigineId) return { color: '#1a6ef5', weight: 3, fillOpacity: 0.12 };
    if (id === this.zoneDestId) return { color: '#ff9500', weight: 3, fillOpacity: 0.12 };
    return { color: '#888', weight: 1, fillOpacity: 0.03 };
  }

  private restyler() {
    this.couchesZones.forEach((couche, id) => couche.setStyle(() => this.styleZone(id)));
  }

  private dessinerZones(fc: any) {
    (fc.features || []).forEach((f: any) => {
      const id = f.properties.id;
      const couche = L.geoJSON(f, { style: () => this.styleZone(id) })
        .bindTooltip(f.properties.nom, { sticky: true })
        .addTo(this.carte);
      couche.on('click', () => this.choisirZoneDest(id));
      this.couchesZones.set(id, couche);
    });
  }

  async localiser() {
    try {
      const pos = await Geolocation.getCurrentPosition();
      this.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      this.maPosition?.remove();
      this.maPosition = L.circleMarker([this.position.lat, this.position.lon], {
        radius: 8, color: '#1a6ef5', fillColor: '#1a6ef5', fillOpacity: 0.9,
      }).addTo(this.carte).bindTooltip('Vous');

      this.api.localiserZone(this.position.lat, this.position.lon).subscribe({
        next: (res) => {
          if (res.zone) {
            this.messageZone = null;
            this.definirZoneOrigine(res.zone.id);
            this.showToast(`Vous êtes à ${res.zone.nom}`, 'success');
          } else {
            this.messageZone = 'Vous êtes hors de la zone couverte : choisissez une zone de départ.';
          }
          this.cdr.markForCheck();
        },
        error: (err) => console.error(err),
      });
    } catch (err) {
      console.error(err);
      this.messageZone = 'Position indisponible : choisissez une zone de départ.';
      this.cdr.markForCheck();
    }
  }

  definirZoneOrigine(id: number | null) {
    if (id === this.zoneOrigineId && this.minuteur) return;
    this.zoneOrigineId = id ?? null;
    this.resultats = [];
    this.recherchEffectuee = false;
    this.groupeMontee.clearLayers();
    this.arreterRafraichissement();
    this.effacerBus();
    this.restyler();
    if (!this.zoneOrigineId) return;
    const couche = this.couchesZones.get(this.zoneOrigineId);
    if (couche) this.carte.fitBounds(couche.getBounds(), { padding: [20, 20] });
    this.rafraichir();
    this.minuteur = setInterval(() => this.rafraichir(), 3000);
  }

  // ----- Destination -----

  choisirZoneDest(id: number | null) {
    this.zoneDestId = id ?? null;
    this.arretDestId = null;
    this.arretsDest = [];
    this.groupeDest.clearLayers();
    this.marqueursDest.clear();
    this.resultats = [];
    this.recherchEffectuee = false;
    this.groupeMontee.clearLayers();
    this.restyler();
    if (!this.zoneDestId) {
      this.cdr.markForCheck();
      return;
    }
    const couche = this.couchesZones.get(this.zoneDestId);
    if (couche) this.carte.fitBounds(couche.getBounds(), { padding: [20, 20] });

    this.api.getArretsZone(this.zoneDestId).subscribe({
      next: (arrets) => {
        this.arretsDest = arrets;
        arrets.forEach((a) => {
          const m = L.circleMarker([a.latitude, a.longitude], {
            radius: 8, color: '#ff9500', fillColor: '#ff9500', fillOpacity: 0.9,
          })
            .bindTooltip(a.nom)
            .on('click', () => this.selectionnerArretDest(a.id));
          this.marqueursDest.set(a.id, m);
          this.groupeDest.addLayer(m);
        });
        this.cdr.markForCheck();
      },
    });
  }

  selectionnerArretDest(id: number | null) {
    this.arretDestId = id ?? null;
    this.marqueursDest.forEach((m, mid) => {
      const choisi = mid === this.arretDestId;
      const couleur = choisi ? '#eb445a' : '#ff9500';
      m.setStyle({ color: couleur, fillColor: couleur });
      m.setRadius(choisi ? 11 : 8);
    });
    this.cdr.markForCheck();
  }

  // ----- Recherche et rafraîchissement -----

  chercher() {
    if (!this.zoneOrigineId) {
      this.showToast('Choisissez votre zone de départ', 'warning');
      return;
    }
    if (!this.arretDestId) {
      this.showToast('Choisissez un arrêt de destination', 'warning');
      return;
    }
    this.recherchEffectuee = true;
    this.etaInitiale.clear();
    this.retoursEnvoyes.clear();
    this.chargerResultats(true);
  }

  private rafraichir() {
    if (!this.zoneOrigineId) return;
    this.api.getBusPresents(this.zoneOrigineId).subscribe({
      next: (bus) => this.mettreAJourBus(bus),
    });
    if (this.recherchEffectuee) this.chargerResultats(false);
  }

  private chargerResultats(premiere: boolean) {
    if (!this.zoneOrigineId || !this.arretDestId) return;
    this.api
      .itineraire(this.zoneOrigineId, this.arretDestId, this.position?.lat ?? null, this.position?.lon ?? null)
      .subscribe({
        next: (res) => {
          res.forEach((r) => {
            if (r.etaMinutes !== 0) this.retoursEnvoyes.delete(r.busId);
            if (r.etaMinutes > 0 && !this.etaInitiale.has(r.busId)) {
              this.etaInitiale.set(r.busId, r.etaMinutes);
            }
          });
          this.resultats = res;
          this.messageResultat = null;
          this.mettreAJourMontee(res);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.resultats = [];
          this.messageResultat = err.error?.error || 'Aucun résultat trouvé';
          this.groupeMontee.clearLayers();
          if (premiere) this.showToast(this.messageResultat!, 'danger');
          this.cdr.markForCheck();
        },
      });
  }

  private mettreAJourBus(bus: any[]) {
    const ids = new Set(bus.map((b) => b.id));
    this.marqueursBus.forEach((m, id) => {
      if (!ids.has(id)) {
        m.remove();
        this.marqueursBus.delete(id);
      }
    });
    bus.forEach((b) => {
      const pos: L.LatLngExpression = [b.latitude, b.longitude];
      const existant = this.marqueursBus.get(b.id);
      if (existant) {
        existant.setLatLng(pos);
      } else {
        const icone = L.divIcon({
          html: '<div style="font-size:26px;line-height:26px">🚌</div>',
          className: '',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const m = L.marker(pos, { icon: icone })
          .addTo(this.carte)
          .bindTooltip(`Ligne ${b.num_ligne}${b.num_bus ? ' · Bus ' + b.num_bus : ''}`);
        this.marqueursBus.set(b.id, m);
      }
    });
    this.nbBusZone = bus.length;
    this.cdr.markForCheck();
  }

  private effacerBus() {
    this.marqueursBus.forEach((m) => m.remove());
    this.marqueursBus.clear();
    this.nbBusZone = 0;
  }

  private mettreAJourMontee(res: any[]) {
    this.groupeMontee.clearLayers();
    res.forEach((r) => {
      this.groupeMontee.addLayer(
        L.circleMarker([r.arretMontee.latitude, r.arretMontee.longitude], {
          radius: 9, color: '#2dd36f', fillColor: '#2dd36f', fillOpacity: 0.9,
        }).bindTooltip(`Montée : ${r.arretMontee.nom}`)
      );
    });
  }

  private arreterRafraichissement() {
    if (this.minuteur) {
      clearInterval(this.minuteur);
      this.minuteur = null;
    }
  }

  trackByBus(_: number, r: any) {
    return r.busId;
  }

  // ----- Retours -----

  envoyerRetour(busId: number, arretId: number, statut: string) {
    const etaPrevue = this.etaInitiale.get(busId) ?? null;
    this.api.ajouterRetour(busId, arretId, statut, etaPrevue).subscribe({
      next: () => {
        if (statut !== 'pas_venu') {
          this.retoursEnvoyes.add(busId);
          this.etaInitiale.delete(busId);
        }
        this.showToast('Merci pour ton retour !', 'success');
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(err);
        this.showToast("Erreur lors de l'envoi du retour", 'danger');
      },
    });
  }

  private async showToast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, color, position: 'top' });
    await t.present();
  }
}